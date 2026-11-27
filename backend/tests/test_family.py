from contextlib import contextmanager

import pytest
from fastapi import FastAPI, WebSocketDisconnect
from fastapi.testclient import TestClient

from app.family.api import create_family_router
from app.family.store import INVITE_SECONDS, MemoryFamilyStore


@pytest.fixture
def server():
    now = [1_800_000_000]
    app = FastAPI()
    app.include_router(create_family_router(MemoryFamilyStore(lambda: now[0])))
    with TestClient(app) as client:
        yield client, now


def register(client):
    response = client.post("/api/family/register", json={"name": "అబ్బాయి"})
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()


def confirm(client, code, name="అమ్మ", phone=None):
    preview = client.post("/api/family/inspect", json={"code": code})
    assert preview.status_code == 200
    assert preview.json()["family_name"] == "అబ్బాయి"
    response = client.post("/api/family/confirm", json={
        "name": name, "phone": phone, "code": code, "pair_id": preview.json()["pair_id"], "consent": True,
    })
    assert response.status_code == 200
    return response.json()["token"]


def until(ws, condition):
    for _ in range(8):
        message = ws.receive_json()
        if condition(message):
            return message
    pytest.fail("Expected event did not arrive")


@contextmanager
def link(client, token):
    with client.websocket_connect("/api/family/socket") as ws:
        ws.send_json({"type": "auth", "token": token})
        yield ws, ws.receive_json()


def test_pairing_consent_expiry_rotation_and_single_use(server):
    client, now = server
    invitation = register(client)
    assert client.post("/api/family/inspect", json={"code": "AAAAAAAAAAAA"}).status_code == 404
    preview = client.post("/api/family/inspect", json={"code": invitation["code"]}).json()
    body = {"code": invitation["code"], "name": "Elder", "pair_id": preview["pair_id"]}
    assert client.post("/api/family/confirm", json={**body, "consent": False}).status_code == 422
    now[0] += INVITE_SECONDS
    expired = client.post("/api/family/confirm", json={**body, "consent": True})
    assert expired.status_code == 410
    refreshed = client.post("/api/family/invite", headers={"Authorization": f"Bearer {invitation['token']}"})
    assert refreshed.status_code == 200
    code = refreshed.json()["code"]
    assert confirm(client, code)
    reuse = client.post("/api/family/confirm", json={**body, "code": code, "consent": True})
    assert reuse.status_code == 404


def test_pairing_attempts_are_limited(server):
    client, now = server
    for _ in range(12):
        assert client.post("/api/family/inspect", json={"code": "AAAAAAAAAAAA"}).status_code == 404
    assert client.post("/api/family/inspect", json={"code": "AAAAAAAAAAAA"}).status_code == 429
    now[0] += 60
    assert client.post("/api/family/inspect", json={"code": "AAAAAAAAAAAA"}).status_code == 404


def test_unauthorized_socket_origin_and_restart(server):
    client, _ = server
    token = register(client)["token"]
    restarted = FastAPI()
    restarted.include_router(create_family_router(MemoryFamilyStore()))
    with TestClient(restarted) as fresh, pytest.raises(WebSocketDisconnect) as revoked:
        with link(fresh, token):
            pytest.fail("Old credential survived restart")
    assert revoked.value.code == 4401
    with pytest.raises(WebSocketDisconnect) as invalid:
        with link(client, "z" * 43):
            pytest.fail("Unknown credentials authenticated")
    assert invalid.value.code == 4401
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/family/socket", headers={"Origin": "https://foreign.example"}):
            pytest.fail("Unexpected origin authenticated")


def test_two_clients_delivery_reconnect_acknowledge_and_revocation(server):
    client, _ = server
    invite = register(client)
    elder = confirm(client, invite["code"], phone="+12025550123")
    publish = {"type": "publish", "id": "a" * 32, "category": "legal_threat", "state": "warning"}
    with link(client, elder) as (elder_ws, snapshot):
        assert snapshot["peer_online"] is False and snapshot["phone"] is None
        elder_ws.send_json({"type": "status", "protection": "listening"})
        elder_ws.send_json(publish)
        saved = until(elder_ws, lambda event: event.get("alerts"))
        assert len(saved["alerts"]) == 1 and not saved["peer_online"]
        with link(client, invite["token"]) as (family_ws, recovered):
            assert recovered["peer_online"] and recovered["phone"] == "+12025550123"
            assert recovered["protection"] == "listening"
            assert recovered["alerts"] == saved["alerts"]
            assert "transcript" not in recovered["alerts"][0]
            family_ws.send_json({"type": "ping"})
            until(family_ws, lambda event: event["type"] == "pong")
            elder_ws.send_json(publish)
            duplicate = until(family_ws, lambda event: event.get("alerts"))
            assert len(duplicate["alerts"]) == 1
            family_ws.send_json({"type": "ack", "id": publish["id"], "state": "critical"})
            until(family_ws, lambda event: event.get("code") == "alert_changed")
            family_ws.send_json({"type": "ack", "id": publish["id"], "state": "warning"})
            until(elder_ws, lambda event: bool(event.get("alerts") and event["alerts"][0]["acknowledged_at"]))
            elder_ws.send_json({**publish, "state": "rescue"})
            upgraded = until(family_ws, lambda event: bool(event.get("alerts") and event["alerts"][0]["state"] == "rescue"))
            assert len(upgraded["alerts"]) == 1 and not upgraded["alerts"][0]["acknowledged_at"]
        until(elder_ws, lambda event: event.get("peer_online") is False)
        response = client.post("/api/family/unlink", headers={"Authorization": f"Bearer {elder}"})
        assert response.status_code == 200
        with pytest.raises(WebSocketDisconnect):
            until(elder_ws, lambda event: False)
    with pytest.raises(WebSocketDisconnect):
        with link(client, invite["token"]):
            pytest.fail("Family credential survived unlinking")


def test_separate_family_cannot_access_or_acknowledge_another_alert(server):
    client, _ = server
    first = register(client)
    second = register(client)
    elder = confirm(client, first["code"])
    confirm(client, second["code"], name="Second elder")
    alert_id = "b" * 32
    with link(client, elder) as (sender, _), link(client, second["token"]) as (receiver, snapshot):
        assert snapshot["elder_name"] == "Second elder"
        sender.send_json({"type": "publish", "id": alert_id, "state": "rescue", "category": "coercion"})
        until(sender, lambda event: event.get("alerts"))
        receiver.send_json({"type": "ack", "id": alert_id, "state": "rescue"})
        error = until(receiver, lambda event: event["type"] == "error")
        assert error["code"] == "unknown_alert"
        receiver.send_json({"type": "publish", "id": alert_id, "state": "rescue", "category": "coercion"})
        until(receiver, lambda event: event.get("code") == "wrong_role")
        sender.send_json({"type": "ack", "id": alert_id, "state": "rescue"})
        until(sender, lambda event: event.get("code") == "wrong_role")
