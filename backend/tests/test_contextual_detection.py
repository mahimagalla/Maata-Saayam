import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.scam.engine import TranscriptFragment, analyze

AUDIT_CASES = (
    ("Good morning, how are you?", 0, 0, "CONTINUE_LISTENING"),
    ("What time will you come home?", 0, 0, "CONTINUE_LISTENING"),
    ("My son works in the police department.", 0, 0, "CONTINUE_LISTENING"),
    ("I need to complete KYC at my bank branch.", 0, 0, "CONTINUE_LISTENING"),
    ("The bank sent me an OTP for my own login.", 0, 0, "CONTINUE_LISTENING"),
    ("My daughter is calling me.", 0, 0, "CONTINUE_LISTENING"),
    ("I received a parcel yesterday.", 0, 0, "CONTINUE_LISTENING"),
    ("Please don't tell anyone about the birthday surprise.", 0, 0, "CONTINUE_LISTENING"),
    ("Don't tell your family.", 18, 18, "CONTINUE_LISTENING"),
    ("Don't hang up.", 21, 21, "CONTINUE_LISTENING"),
    ("Keep this conversation confidential.", 18, 18, "CONTINUE_LISTENING"),
    ("Your bank account will be blocked immediately.", 12, 30, "SHOW_CAUTION"),
    ("Send me your OTP for verification.", 22, 30, "SHOW_CAUTION"),
    ("I am calling from CBI. You are under digital arrest.", 42, 54, "SPOKEN_WARNING"),
    ("Don't tell your family. Don't hang up. Transfer your money to the safe account.", 63, 75, "FAMILY_RESCUE"),
    ("If you disconnect this call, you will be arrested.", 0, 50, "SPOKEN_WARNING"),
    ("Your parcel contains illegal items. Pay immediately to avoid arrest.", 42, 68, "SPOKEN_WARNING"),
)


@pytest.mark.parametrize(("text", "_previous", "score", "action"), AUDIT_CASES)
def test_audit_replay(text, _previous, score, action):
    result = analyze(text)
    assert (result.risk_score, result.recommended_action) == (score, action)
    assert all(text[signal.start:signal.end] == signal.evidence for signal in result.detected_signals)


@pytest.mark.parametrize("text", [
    "Don't tell anyone your OTP.",
    "I need to pay the school fee.",
    "Please don't hang up while I find my glasses.",
    "Can you tell me what OTP means?",
    "Only 10 minutes until lunch.",
    "I am a customs officer. I read about a digital arrest scam. I need to pay the school fee.",
    "I am a police officer organizing the school visit. Please don't tell anyone about the retirement gift.",
    "He said, “You are under arrest. Transfer your money to the safe account.”",
    "The caller said, 'Send me your OTP.'",
    "The caller told me to send my OTP. I did not share it.",
    "My account was blocked yesterday.",
    "Transfer money now for groceries.",
])
def test_benign_or_reported_speech_is_not_a_live_demand(text):
    assert analyze(text).risk_score == 0


@pytest.mark.parametrize("text", [
    "You are under arrest.",
    "You will be arrested.",
    "I will arrest you if you hang up.",
    "I will have you arrested if you hang up.",
    "If you disconnect this call you will be arrested.",
])
def test_direct_or_conditional_arrest_warns(text):
    result = analyze(text)
    assert result.recommended_action == "SPOKEN_WARNING"
    assert "legal_threat" in {signal.category for signal in result.detected_signals}
    if "if you" in text.lower():
        assert any(signal.category == "coercion" and "if you" in signal.evidence.lower()
                   and "arrest" in signal.evidence.lower() for signal in result.detected_signals)


def test_close_related_instructions_are_distinct_from_an_isolated_request():
    assert analyze("Don't tell your family. Don't hang up.").recommended_action == "SHOW_CAUTION"
    assert analyze("Transfer your money to the safe account.").recommended_action == "SHOW_CAUTION"
    assert analyze("వెంటనే డబ్బులు safe account కి పంపండి. ఓటీపీ చెప్పండి.").recommended_action == "SPOKEN_WARNING"
    assert analyze("For my own login I use an OTP, but send me your OTP.").recommended_action == "SHOW_CAUTION"


def fragments(*items: tuple[int, str]) -> tuple[TranscriptFragment, ...]:
    return tuple(TranscriptFragment(id=index, finalized_at_ms=at, text=text)
                 for index, (at, text) in enumerate(items, 1))


def test_conditional_threat_can_cross_two_close_finalized_fragments():
    parts = fragments((1000, "If you disconnect this call,"), (7000, "you will be arrested."))
    result = analyze("", fragments=parts)
    assert result.recommended_action == "SPOKEN_WARNING"
    assert result.evidence_fragment_ids == [1, 2]
    assert any("disconnect this call,\nyou will be arrested" in evidence for evidence in result.evidence)


def test_an_incomplete_request_can_continue_in_a_close_finalized_fragment():
    parts = fragments((1000, "Send me"), (2000, "your OTP for verification."))
    result = analyze("", fragments=parts)
    assert result.recommended_action == "SHOW_CAUTION"
    assert result.evidence_fragment_ids == [1, 2]
    assert result.evidence == ["Send me\nyour OTP"]


def test_conversation_time_and_neutral_fragments_break_combinations():
    authority = "I am calling from CBI."
    legal = "You are under digital arrest."
    payment = "Transfer your money to the safe account."
    linked = analyze("", fragments=fragments((1000, authority), (4000, legal), (7000, payment)))
    distant = analyze("", fragments=fragments((1000, authority), (15000, legal), (29000, payment)))
    interrupted = analyze("", fragments=fragments(
        (1000, authority), (4000, legal), (7000, "Good morning, how are you?"), (8000, payment),
    ))
    assert linked.recommended_action == "FAMILY_RESCUE"
    assert linked.evidence_fragment_ids == [1, 2, 3]
    assert distant.risk_score == 50
    assert distant.evidence_fragment_ids == [2]
    assert interrupted.risk_score == 54
    assert interrupted.evidence_fragment_ids == [1, 2]
    labeled = analyze("Caller: I am calling from CBI.\nRecipient: You are under digital arrest.")
    assert labeled.risk_score == 50
    assert {signal.category for signal in labeled.detected_signals} == {"legal_threat"}


def test_endpoint_accepts_timestamped_fragments_and_validates_timeline():
    async def request():
        parts = [part.model_dump() for part in fragments(
            (1000, "If you disconnect this call,"), (2000, "you will be arrested."),
        )]
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            payload = {"language": "en-IN", "fragments": parts}
            response = await client.post("/api/analyze", json=payload)
            assert response.status_code == 200
            assert response.json()["evidence_fragment_ids"] == [1, 2]
            assert response.headers["Cache-Control"] == "no-store"
            assert (await client.post("/api/analyze", json={**payload, "fragments": parts[::-1]})).status_code == 422
            assert (await client.post("/api/analyze", json={**payload, "transcript": "also text"})).status_code == 422

    asyncio.run(request())
