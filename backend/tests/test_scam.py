import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.scam.engine import ScoringPolicy, analyze
from app.scam.normalization import normalize


@pytest.mark.parametrize(("transcript", "expected"), [
    (
        "నేను పోలీస్ అధికారిని. మీరు డిజిటల్ అరెస్ట్ అయ్యారు. వెంటనే డబ్బులు సేఫ్ అకౌంట్ లోకి పంపండి. "
        "ఎవరికీ చెప్పకండి. ఫోన్ పెట్టేయకండి.",
        {"authority_impersonation", "legal_threat", "financial_manipulation", "secrecy_isolation", "coercion"},
    ),
    (
        "పోలీస్ డిపార్ట్మెంట్ నుంచి మాట్లాడుతున్నాను. Your parcel contains drugs. "
        "మీ మీద criminal case పెడతాం. ఓటీపీ ప్లీజ్ చెప్పండి. Transfer money now.",
        {"authority_impersonation", "parcel_scam", "legal_threat", "credential_theft", "financial_manipulation"},
    ),
    (
        "I am a senior CBI officer. We will arrest you today. Move your funds to the safe account. "
        "Don't tell your family. You have only 5 minutes. Do not hang up.",
        {"authority_impersonation", "legal_threat", "financial_manipulation", "secrecy_isolation", "urgency", "coercion"},
    ),
    (
        "मैं पुलिस से बोल रहा हूँ। आपका डिजिटल arrest होगा। अभी पैसे safe account में भेजो। "
        "OTP बताओ। घरवालों को मत बताना। फोन मत काटना।",
        {"authority_impersonation", "legal_threat", "financial_manipulation", "credential_theft", "secrecy_isolation", "coercion"},
    ),
    (
        "Main police se bol raha hoon. Digital arresst. Abhi paise tranfer to safe akount. "
        "O T P batao. Gharwalo ko mat batana.",
        {"authority_impersonation", "legal_threat", "financial_manipulation", "credential_theft", "secrecy_isolation"},
    ),
])
def test_multilingual_scam_patterns(transcript, expected):
    result = analyze(transcript)
    assert result.risk_level == "critical"
    assert result.recommended_action == "FAMILY_RESCUE"
    assert {signal.category for signal in result.detected_signals} == expected
    for signal in result.detected_signals:
        assert transcript[signal.start:signal.end] == signal.evidence
        assert signal.evidence in result.evidence


def test_normalization_preserves_source_and_meaningful_negation():
    original = "  ఓ టి  ఓటీపీ   O T P\nకేవైసీ KYC, అకౌంట్ పోలీస్ అరెస్ట్ ప్లీజ్ డబ్బులు పంపండి."
    normalized = normalize(original)
    assert normalized.original == original
    assert "OTP" in normalized.text
    assert normalized.text.splitlines()[1:] == ["KYC", "account police arrest please money send"]
    assert normalize("OTP అడగకండి").text == "OTP do not ask"
    assert normalize("OTP అడుగుతున్నారు").text == "OTP ask"
    assert normalize("ＯＴＰ\tओटीपी").text == "OTP"


@pytest.mark.parametrize("transcript", [
    "My son works in the police department.",
    "I need to complete KYC at my bank branch.",
    "Please send me the OTP for my own login.",
    "The police officer helped me yesterday.",
    "My bank account needs verification.",
    "Please don't tell anyone about my birthday surprise.",
    "I am talking to the police about my missing wallet.",
    "నా కుమారుడు పోలీస్ విభాగంలో పని చేస్తాడు. కేవైసీ కోసం బ్యాంకుకు వెళ్తాను.",
    "मेरा भाई पुलिस में काम करता है। KYC बैंक शाखा में करना है।",
])
def test_genuine_calls_are_low_risk(transcript):
    result = analyze(transcript)
    assert result.risk_level == "low"
    assert not result.detected_signals


@pytest.mark.parametrize("transcript", [
    "OTP అడగకండి",
    "Never share your banking password.",
    "Your bank will never ask you for an OTP.",
    "OTP शेयर मत करो।",
    "I am not a police officer. We will not arrest you. Your account will not be blocked.",
    "Do not transfer money now. The parcel does not contain drugs.",
])
def test_negative_safety_statements_do_not_count(transcript):
    assert analyze(transcript).detected_signals == []


def test_negation_does_not_hide_a_separate_request():
    result = analyze("Don't share the password but OTP అడుగుతున్నారు.")
    assert [(signal.category, signal.evidence) for signal in result.detected_signals] == [
        ("credential_theft", "OTP అడుగుతున్నారు"),
    ]
    assert analyze("OTP అడగకండి, OTP అడుగుతున్నారు.").evidence == ["OTP అడుగుతున్నారు"]


def test_phonetic_spellings_and_asr_errors_keep_original_evidence():
    transcript = "ప్లీజ్ ఓటిపి చెప్పండి. Transfar money to the safe acount."
    result = analyze(transcript)
    assert result.risk_score == 58
    assert result.risk_level == "high_caution"
    assert result.recommended_action == "SPOKEN_WARNING"
    assert {signal.match_quality for signal in result.detected_signals} == {"normalized_variant"}
    assert result.evidence == ["ఓటిపి చెప్పండి", "Transfar money to the safe acount"]


def test_duplicates_do_not_inflate_scores():
    single = analyze("Please share your OTP. Transfer money now.")
    duplicate = analyze("Please please share your OTP. Please share your OTP. Transfer money now. "
                        "Transfer money now. Give me your password.")
    assert duplicate.risk_score == single.risk_score
    assert duplicate.transcript_quality.duplicates_removed == 3
    assert len(duplicate.detected_signals) == 2


@pytest.mark.parametrize(("transcript", "status"), [("", "empty"), ("  । ! ", "empty"), ("OTP", "limited")])
def test_empty_and_incomplete_input(transcript, status):
    result = analyze(transcript)
    assert result.transcript_quality.status == status
    assert result.risk_score == 0
    assert result.recommended_action == "CONTINUE_LISTENING"


def test_isolated_and_combined_signals_score_differently():
    authority = analyze("I'm calling from the police.")
    secrecy = analyze("Do not tell your family.")
    combined = analyze("I'm calling from the police. Do not tell your family.")
    assert combined.risk_score == authority.risk_score + secrecy.risk_score + 10
    assert combined.recommended_action == "SHOW_CAUTION"
    assert analyze("Do not hang up.").risk_score > 0
    policy = ScoringPolicy(weights={"legal_threat": 100})
    assert analyze("You are under digital arrest.", policy).risk_score == 69


def test_unpunctuated_asr_transcript_still_combines_distinct_signals():
    result = analyze("I am from the CBI we will arrest you transfer money to the safe account")
    assert result.risk_score == 86
    assert result.recommended_action == "FAMILY_RESCUE"


def test_analysis_endpoint_validates_input_and_does_not_cache():
    async def request():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            payload = {"transcript": "ఓటీపీ చెప్పండి. Transfer money now.", "language": "te-IN"}
            response = await client.post("/api/analyze", json={**payload, "session_id": "demo"})
            assert response.status_code == 200
            assert response.headers["Cache-Control"] == "no-store"
            assert response.json() == analyze(payload["transcript"]).model_dump()
            assert (await client.post("/api/analyze", json={**payload, "language": "fr"})).status_code == 422
            assert (await client.post("/api/analyze", json={**payload, "transcript": "a" * 20_001})).status_code == 422

    asyncio.run(request())
