"""In-memory prototype repository. Methods run on one asyncio event loop."""
import hashlib
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal, Protocol

Role = Literal["family", "elder"]
Protection = Literal["idle", "listening", "caution", "warning", "critical", "unavailable"]
Threat = Literal["authority_impersonation", "legal_threat", "secrecy_isolation", "financial_manipulation",
                 "credential_theft", "urgency", "parcel_scam", "coercion", "other"]
AlertState = Literal["warning", "critical", "rescue"]
INVITE_SECONDS = 300
UNPAIRED_SECONDS = 1800
DEVICE_SECONDS = 7 * 24 * 3600
ALERT_LIMIT = 40
EXPLANATIONS: dict[str, str] = {
    "authority_impersonation": "The caller may be impersonating an authority. Check in with your elder.",
    "legal_threat": "The caller used a legal threat to pressure the elder. Check in with them.",
    "secrecy_isolation": "The caller tried to isolate the elder. Check in with them.",
    "financial_manipulation": "The caller may be pressuring the elder to send money. Check in with them.",
    "credential_theft": "The caller may be asking for private banking credentials. Check in with your elder.",
    "urgency": "The caller put the elder under time pressure. Check in with them.",
    "parcel_scam": "The caller used a suspicious parcel claim. Check in with your elder.",
    "coercion": "The caller tried to control the conversation. Check in with your elder.",
    "other": "Maata-Saayam detected serious manipulation. Check in with your elder.",
}
ORDER = {"warning": 0, "critical": 1, "rescue": 2}


class PairingError(Exception):
    def __init__(self, status: int, code: str):
        self.status, self.code = status, code


def digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


@dataclass
class Alert:
    id: str
    timestamp: str
    elder_name: str
    category: Threat
    explanation: str
    state: AlertState
    acknowledged_at: str | None = None


@dataclass
class Pair:
    id: str
    family_name: str
    expires_at: float
    elder_name: str | None = None
    phone: str | None = None
    invite: str | None = None
    alerts: dict[str, Alert] = field(default_factory=dict)
    retired_ids: dict[str, None] = field(default_factory=dict)


class FamilyStore(Protocol):
    def rate_limit(self, key: str, limit: int) -> None: ...
    def authenticate(self, token: str) -> tuple[Pair, Role]: ...
    def register(self, name: str) -> tuple[str, str, str]: ...
    def issue_invite(self, pair: Pair) -> tuple[str, str]: ...
    def invite_pair(self, code: str) -> Pair: ...
    def pair_elder(self, code: str, name: str, phone: str | None, expected_pair_id: str) -> tuple[Pair, str]: ...
    def revoke(self, pair: Pair) -> None: ...
    def publish(self, pair: Pair, alert_id: str, category: Threat, state: AlertState) -> None: ...
    def acknowledge(self, pair: Pair, alert_id: str, state: AlertState) -> None: ...


class MemoryFamilyStore:
    def __init__(self, clock=time.time):
        self.clock = clock
        self.pairs: dict[str, Pair] = {}
        self.devices: dict[str, tuple[str, Role]] = {}
        self.invites: dict[str, tuple[str, float]] = {}
        self.attempts: dict[str, tuple[float, int]] = {}

    def rate_limit(self, key: str, limit: int):
        now = self.clock()
        self.attempts = {key: value for key, value in self.attempts.items() if value[0] > now}
        expires, count = self.attempts.get(key, (now + 60, 0))
        if count >= limit or (key not in self.attempts and len(self.attempts) >= 4096):
            raise PairingError(429, "rate_limited")
        self.attempts[key] = (expires, count + 1)

    def expire(self, now: float):
        for pair in list(self.pairs.values()):
            if pair.expires_at <= now:
                self.revoke(pair)
        for key, (_, deadline) in list(self.invites.items()):
            if deadline <= now:
                del self.invites[key]

    def issue_device(self, pair: Pair, role: Role) -> str:
        token = secrets.token_urlsafe(32)
        self.devices[digest(token)] = (pair.id, role)
        return token

    def authenticate(self, token: str) -> tuple[Pair, Role]:
        if len(token) > 128:
            raise PairingError(401, "invalid_credential")
        identity = self.devices.get(digest(token))
        pair = self.pairs.get(identity[0]) if identity else None
        if pair is None or pair.expires_at <= self.clock():
            if pair:
                self.revoke(pair)
            raise PairingError(401, "invalid_credential")
        return pair, identity[1]

    def register(self, name: str) -> tuple[str, str, str]:
        now = self.clock()
        self.expire(now)
        if len(self.pairs) >= 512:
            raise PairingError(503, "capacity")
        pair = Pair(secrets.token_hex(16), name, now + UNPAIRED_SECONDS)
        self.pairs[pair.id] = pair
        code, expires = self.issue_invite(pair)
        return self.issue_device(pair, "family"), code, expires

    def issue_invite(self, pair: Pair) -> tuple[str, str]:
        if pair.elder_name is not None:
            raise PairingError(409, "already_paired")
        if pair.invite:
            self.invites.pop(pair.invite, None)
        code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(12))
        pair.invite = digest(code)
        expires = self.clock() + INVITE_SECONDS
        self.invites[pair.invite] = (pair.id, expires)
        return code, iso(expires)

    def invite_pair(self, code: str) -> Pair:
        key = digest(code)
        entry = self.invites.get(key)
        if not entry:
            raise PairingError(404, "invalid_code")
        pair = self.pairs.get(entry[0])
        if entry[1] <= self.clock():
            self.invites.pop(key, None)
            raise PairingError(410, "expired_code")
        if pair is None or pair.elder_name is not None:
            raise PairingError(404, "invalid_code")
        return pair

    def pair_elder(self, code: str, name: str, phone: str | None, expected_pair_id: str) -> tuple[Pair, str]:
        pair = self.invite_pair(code)
        if pair.id != expected_pair_id:
            raise PairingError(409, "invite_changed")
        self.invites.pop(pair.invite or "", None)
        pair.invite = None
        pair.elder_name = name
        pair.phone = phone
        pair.expires_at = self.clock() + DEVICE_SECONDS
        return pair, self.issue_device(pair, "elder")

    def revoke(self, pair: Pair):
        if pair.invite:
            self.invites.pop(pair.invite, None)
        self.pairs.pop(pair.id, None)
        self.devices = {key: value for key, value in self.devices.items() if value[0] != pair.id}

    def publish(self, pair: Pair, alert_id: str, category: Threat, state: AlertState):
        if pair.elder_name is None:
            raise PairingError(409, "not_paired")
        if alert_id in pair.retired_ids:
            raise PairingError(409, "retired_alert")
        alert = pair.alerts.get(alert_id)
        if alert:
            if ORDER[state] <= ORDER[alert.state]:
                return
            alert.state, alert.category = state, category
            alert.explanation = EXPLANATIONS[category]
            alert.acknowledged_at = None
        else:
            if len(pair.alerts) >= ALERT_LIMIT:
                oldest = next(iter(pair.alerts))
                del pair.alerts[oldest]
                pair.retired_ids[oldest] = None
            if len(pair.retired_ids) > 256:
                del pair.retired_ids[next(iter(pair.retired_ids))]
            pair.alerts[alert_id] = Alert(alert_id, iso(self.clock()), pair.elder_name,
                                          category, EXPLANATIONS[category], state)

    def acknowledge(self, pair: Pair, alert_id: str, state: AlertState):
        alert = pair.alerts.get(alert_id)
        if not alert:
            raise PairingError(404, "unknown_alert")
        if alert.state != state:
            raise PairingError(409, "alert_changed")
        if alert.acknowledged_at is None:
            alert.acknowledged_at = iso(self.clock())
