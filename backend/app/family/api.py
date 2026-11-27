import asyncio
import os
from dataclasses import asdict
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, ValidationError

from .store import AlertState, FamilyStore, Pair, PairingError, Protection, Role, Threat

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Code = Annotated[str, StringConstraints(pattern=r"^[A-HJ-NP-Z2-9]{12}$")]
Identifier = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{32}$")]
Phone = Annotated[str, StringConstraints(pattern=r"^\+?[0-9]{7,15}$")]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Register(Input):
    name: Name


class Invite(Input):
    code: Code


class Confirm(Invite):
    pair_id: Identifier
    name: Name
    phone: Phone | None = None
    consent: Literal[True]


class Credentials(Input):
    type: Literal["auth"]
    token: Annotated[str, StringConstraints(min_length=32, max_length=128)]


class Ping(Input):
    type: Literal["ping"]


class Status(Input):
    type: Literal["status"]
    protection: Protection


class Publish(Input):
    type: Literal["publish"]
    id: Identifier
    category: Threat
    state: AlertState


class Ack(Input):
    type: Literal["ack"]
    id: Identifier
    state: AlertState


Message = TypeAdapter(Annotated[Ping | Status | Publish | Ack, Field(discriminator="type")])


class Connections:
    def __init__(self):
        self.clients: dict[str, dict[asyncio.Queue, Role]] = {}
        self.protection: dict[asyncio.Queue, Protection] = {}

    def snapshot(self, pair: Pair, role: Role):
        clients = self.clients.get(pair.id, {})
        roles = clients.values()
        priority = ("idle", "unavailable", "listening", "caution", "warning", "critical")
        active = [self.protection[queue] for queue in clients if queue in self.protection]
        return {
            "type": "snapshot",
            "paired": pair.elder_name is not None,
            "family_name": pair.family_name,
            "elder_name": pair.elder_name,
            "phone": pair.phone if role == "family" else None,
            "peer_online": ("elder" if role == "family" else "family") in roles,
            "protection": max(active, key=priority.index, default="idle") if "elder" in roles else "unavailable",
            "alerts": [asdict(alert) for alert in reversed(pair.alerts.values())],
        }

    def broadcast(self, pair: Pair):
        for queue, role in self.clients.get(pair.id, {}).items():
            self.enqueue(queue, self.snapshot(pair, role))

    @staticmethod
    def enqueue(queue: asyncio.Queue, event):
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(event)

    def revoke(self, pair: Pair):
        for queue in self.clients.pop(pair.id, {}):
            self.protection.pop(queue, None)
            self.enqueue(queue, None)


def origin_allowed(connection: Request | WebSocket) -> bool:
    origin = connection.headers.get("origin")
    if origin is None:
        return True
    try:
        parsed = urlsplit(origin)
        return parsed.scheme in {"https", "http"} and parsed.netloc.lower() == connection.headers.get("host", "").lower()
    except ValueError:
        return False


def secure(connection: Request | WebSocket) -> bool:
    return os.getenv("FAMILY_REQUIRE_HTTPS") != "1" or connection.url.scheme in {"https", "wss"}


def create_family_router(store: FamilyStore) -> APIRouter:
    router = APIRouter(prefix="/api/family", tags=["family"])
    hub = Connections()

    def perform(operation, *args):
        try:
            return operation(*args)
        except PairingError as exc:
            raise HTTPException(exc.status, exc.code) from None

    def guard(request: Request, response: Response):
        if not secure(request):
            raise HTTPException(403, "secure_transport_required")
        if not origin_allowed(request):
            raise HTTPException(403, "invalid_origin")
        response.headers["Cache-Control"] = "no-store"

    def ip(request: Request):
        return request.client.host if request.client else "unknown"

    def identify(request: Request):
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        if scheme.lower() != "bearer":
            raise HTTPException(401, "invalid_credential")
        return perform(store.authenticate, token)

    @router.post("/register")
    async def register(body: Register, request: Request, response: Response):
        guard(request, response)
        perform(store.rate_limit, "register:global", 120)
        perform(store.rate_limit, "register:" + ip(request), 8)
        token, code, expires = perform(store.register, body.name)
        return {"token": token, "code": code, "expires_at": expires}

    @router.post("/invite")
    async def invite(request: Request, response: Response):
        guard(request, response)
        pair, role = identify(request)
        if role != "family":
            raise HTTPException(403, "wrong_role")
        perform(store.rate_limit, "invite:" + pair.id, 5)
        code, expires = perform(store.issue_invite, pair)
        return {"code": code, "expires_at": expires}

    def limit_attempt(request: Request):
        perform(store.rate_limit, "attempt:global", 240)
        perform(store.rate_limit, "attempt:" + ip(request), 12)

    @router.post("/inspect")
    async def inspect(body: Invite, request: Request, response: Response):
        guard(request, response)
        limit_attempt(request)
        pair = perform(store.invite_pair, body.code)
        return {"pair_id": pair.id, "family_name": pair.family_name}

    @router.post("/confirm")
    async def confirm(body: Confirm, request: Request, response: Response):
        guard(request, response)
        limit_attempt(request)
        pair, token = perform(store.pair_elder, body.code, body.name, body.phone, body.pair_id)
        hub.broadcast(pair)
        return {"token": token}

    @router.post("/unlink")
    async def unlink(request: Request, response: Response):
        guard(request, response)
        pair, _ = identify(request)
        store.revoke(pair)
        hub.revoke(pair)
        return {"unlinked": True}

    @router.websocket("/socket")
    async def socket(websocket: WebSocket):
        if not origin_allowed(websocket) or not secure(websocket):
            await websocket.close(code=4403)
            return
        try:
            store.rate_limit("socket:" + (websocket.client.host if websocket.client else "unknown"), 60)
        except PairingError:
            await websocket.close(code=4429)
            return
        await websocket.accept()
        try:
            auth = Credentials.model_validate(await asyncio.wait_for(websocket.receive_json(), 5))
            pair, role = store.authenticate(auth.token)
        except WebSocketDisconnect:
            return
        except (PairingError, ValueError, asyncio.TimeoutError, TypeError, KeyError):
            await websocket.close(code=4401)
            return
        queue: asyncio.Queue = asyncio.Queue(maxsize=8)
        hub.clients.setdefault(pair.id, {})[queue] = role
        hub.broadcast(pair)
        incoming = asyncio.create_task(websocket.receive_json())
        outgoing = asyncio.create_task(queue.get())
        heartbeat = asyncio.get_running_loop().time() + 35
        try:
            while True:
                timeout = max(0, heartbeat - asyncio.get_running_loop().time())
                done, _ = await asyncio.wait({incoming, outgoing}, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
                if not done:
                    await websocket.close(code=4000)
                    break
                if outgoing in done:
                    event = outgoing.result()
                    if event is None:
                        await websocket.close(code=4401)
                        break
                    await asyncio.wait_for(websocket.send_json(event), 5)
                    outgoing = asyncio.create_task(queue.get())
                if incoming in done:
                    payload = incoming.result()
                    incoming = asyncio.create_task(websocket.receive_json())
                    try:
                        store.authenticate(auth.token)
                    except PairingError:
                        await websocket.close(code=4401)
                        break
                    try:
                        store.rate_limit("events:" + role + ":" + pair.id, 90)
                        message = Message.validate_python(payload)
                        if isinstance(message, Ping):
                            heartbeat = asyncio.get_running_loop().time() + 35
                            await websocket.send_json({"type": "pong"})
                            continue
                        if isinstance(message, Status) and role == "elder":
                            hub.protection[queue] = message.protection
                        elif isinstance(message, Publish) and role == "elder":
                            store.publish(pair, message.id, message.category, message.state)
                        elif isinstance(message, Ack) and role == "family":
                            store.acknowledge(pair, message.id, message.state)
                        else:
                            raise PairingError(403, "wrong_role")
                        hub.broadcast(pair)
                    except (PairingError, ValidationError) as exc:
                        await websocket.send_json({
                            "type": "error",
                            "code": exc.code if isinstance(exc, PairingError) else "invalid_message",
                        })
        except (WebSocketDisconnect, RuntimeError, ValueError, KeyError, asyncio.TimeoutError, asyncio.CancelledError):
            pass
        finally:
            for task in (incoming, outgoing):
                task.cancel()
                if task.done() and not task.cancelled():
                    task.exception()
            clients = hub.clients.get(pair.id)
            hub.protection.pop(queue, None)
            if clients is not None:
                clients.pop(queue, None)
                if not clients:
                    hub.clients.pop(pair.id, None)
                hub.broadcast(pair)

    return router
