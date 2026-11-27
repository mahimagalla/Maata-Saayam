import pytest

from app.scam.engine import TranscriptFragment, analyze

OBSERVED = "Do not tell anyone do not disconnect the call transfer the money to a safe account immediately"
NORMALIZED = "do not tell anyone do not hang up the call transfer the money to a safe account immediately"
EXPECTED = {"secrecy_isolation", "coercion", "financial_manipulation"}


@pytest.mark.parametrize("transcript", [
    OBSERVED,
    NORMALIZED,
    "Don't tell anybody don't hang up send the money to our safe account now",
    "Don't inform your family don't end this call move your funds to a safe account",
    "కుటుంబానికి చెప్పొద్దు కాల్ కట్ చేయకండి డబ్బు సురక్షిత ఖాతాలో పంపండి",
    "ఎవరికీ చెప్పకండి ఫోన్ పెట్టేయకండి వెంటనే డబ్బులు safe account కి పంపండి",
    "किसी को मत बताइए कॉल मत काटिए अभी पैसे सुरक्षित खाते में भेजिए",
    "Don't tell your family फोन मत काटिए వెంటనే డబ్బులు safe account కి పంపండి",
])
def test_linked_call_control_and_payment_survive_unpunctuated_asr(transcript):
    result = analyze(transcript)
    assert (result.risk_score, result.recommended_action) == (75, "FAMILY_RESCUE")
    assert {signal.category for signal in result.detected_signals} == EXPECTED
    assert all(transcript[signal.start:signal.end] == signal.evidence for signal in result.detected_signals)
    if transcript == OBSERVED:
        assert result.normalized_transcript == NORMALIZED
        assert "do not disconnect the call" in result.evidence


@pytest.mark.parametrize("parts", [
    ["Do not tell anyone", "do not disconnect the call", "transfer the money to a safe account immediately"],
    ["Do not tell anyone do not", "disconnect the call", "transfer the money to a safe account immediately"],
])
def test_close_finalized_fragments_share_the_same_episode(parts):
    fragments = tuple(TranscriptFragment(id=i, text=part, finalized_at_ms=i * 1000)
                      for i, part in enumerate(parts, 1))
    result = analyze("", fragments=fragments)
    assert (result.risk_score, result.recommended_action) == (75, "FAMILY_RESCUE")
    assert result.evidence_fragment_ids == [1, 2, 3]


def test_unrelated_and_distant_fragments_do_not_create_rescue():
    fragments = (
        TranscriptFragment(id=1, text="Do not tell anyone", finalized_at_ms=1000),
        TranscriptFragment(id=2, text="do not disconnect the call", finalized_at_ms=2000),
        TranscriptFragment(id=3, text="transfer money to a safe account", finalized_at_ms=17000),
    )
    result = analyze("", fragments=fragments)
    assert result.recommended_action != "FAMILY_RESCUE"


@pytest.mark.parametrize("transcript", [
    "Please do not disconnect the call while I find my glasses",
    "Please don't hang up this phone until I grab the address",
    "Do not say do not disconnect the call",
    "Don't tell anyone your OTP",
    'The caller said "do not tell anyone do not disconnect the call transfer money to a safe account"',
    "Do not tell anyone do not disconnect the call do not transfer money to a safe account",
    "किसी को मत बताइए कॉल मत काटिए मत भेजो पैसे सुरक्षित खाते में",
])
def test_scoped_negation_preserves_benign_holds_reports_and_prohibited_transfers(transcript):
    result = analyze(transcript)
    assert result.risk_score < 50
    assert all(signal.category != "financial_manipulation" for signal in result.detected_signals)
    if "glasses" in transcript or "address" in transcript or "say do" in transcript:
        assert all(signal.category != "coercion" for signal in result.detected_signals)
