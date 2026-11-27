"""Bounded multilingual patterns over normalized clauses."""

import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from .normalization import NormalizedTranscript, Token

Severity = Literal["low", "medium", "high"]


class Signal(BaseModel):
    category: str
    severity: Severity
    evidence: str
    start: int
    end: int
    match_quality: Literal["direct", "normalized_variant"]
    explanation: str


@dataclass(frozen=True)
class Cue:
    signal: Signal
    kind: str
    clause: int
    last_clause: int


@dataclass(frozen=True)
class Rule:
    category: str
    severity: Severity
    pattern: re.Pattern[str]
    explanation: str
    directive: bool = False
    kind: str = ""


def rule(category: str, severity: Severity, pattern: str, explanation: str,
         *, directive: bool = False, kind: str = "") -> Rule:
    return Rule(category, severity, re.compile(r"(?<!\S)(?:" + pattern + r")(?!\S)"),
                explanation, directive, kind)


# Bounded gaps accommodate missing punctuation and extra ASR words without matching across clauses.
NEGATIVE = r"(?:not|never|no|don't|won't|cannot|can't|without)"
GAP = rf"(?: (?!(?:{NEGATIVE}|but)(?: |$))[^ ]+){{0,3}} "
WIDE = rf"(?: (?!(?:{NEGATIVE}|but)(?: |$))[^ ]+){{0,5}} "
AUTHORITY = r"(?:(?:police|cbi|court|customs)(?: officer| department)?|government officer|government department|officer)"
SECRET = r"(?:OTP|pin|password|cvv|banking credentials|bank login|security code)"
REQUEST = r"(?:send|share|tell|ask|asks|asking|give|provide|read out|reveal)"
PAY = r"(?:send|transfer|deposit|move|pay)"
FUNDS = r"(?:money|funds|payment|rupees|inr|balance|\d+)"
TIME = r"(?:now|immediately|urgent|today|right away|within \d+ minutes)"
PROHIBITION = r"(?:don't|do not|never)"
HIDE = rf"{PROHIBITION} (?:tell|inform|contact|call|message|speak to)"
TARGET = r"(?:anyone|family|parents|children|friends|son|daughter|anybody)"
HANG = r"(?:hang up(?: (?:the|this|your) (?:call|phone))?|(?:end|cut|drop) (?:the|this|your) call)"
CALL_CONTROL = rf"{PROHIBITION} {HANG}|stay on the line"
ARREST = r"(?:arrest|arrested)"
RECIPIENT_GAP = GAP.replace("{0,3}", "{0,3}?")
ARREST_THREAT = (rf"(?:(?:you are|you're|you(?: will| shall|'ll) be|you(?: will|'ll) get){GAP}"
                 rf"(?:under (?:digital )?arrest|arrested)"
                 rf"|(?:will|shall|going to){GAP}arrest{RECIPIENT_GAP}you"
                 rf"|(?:will|shall|going to){GAP}(?:have|get) you arrested)")
CLAIM = r"(?:i am|i'm|we are|we're|this is|calling from|speaking from|నేను|మేము|हम|मैं|main)"
ROLE_PREFIX = r"(?: a| an| the| with| from| senior| investigating){0,4} "
SPEAKING = r"(?:speaking|calling|మాట్లాడుతున్నాను|మాట్లాడుతున్నాం|बोल रहा हूं|बोल रहा हूँ|बोल रही हूँ|bol raha hoon|bol rahi hoon)"

RULES = (
    rule("authority_impersonation", "medium",
         rf"(?:calling from|speaking from){ROLE_PREFIX}{AUTHORITY}"
         rf"|{AUTHORITY}(?: officer| department| station| se| से| నుంచి| నుండి){{0,3}} {SPEAKING}"
         rf"|{AUTHORITY} here",
         "The speaker says they are calling on behalf of an authority.", kind="authority_origin"),
    rule("authority_impersonation", "medium",
         rf"{CLAIM}{ROLE_PREFIX}{AUTHORITY}(?! (?:station|building|museum)(?: |$))"
         rf"|{AUTHORITY}(?: officer| department| station| se| से| నుంచి| నుండి){{0,3}} {SPEAKING}"
         rf"|{AUTHORITY} here",
         "The speaker states an authority role.", kind="authority_identity"),
    rule("legal_threat", "high", ARREST_THREAT,
         "The speaker directs an arrest claim or threat at the recipient.", kind="direct_arrest"),
    rule("legal_threat", "high", rf"{PAY}{GAP}to avoid{GAP}{ARREST}",
         "The payment demand is tied to avoiding arrest.", kind="payment_threat"),
    rule("legal_threat", "high", r"digital arrest",
         "The speaker invokes digital arrest.", kind="digital_arrest"),
    rule("legal_threat", "high",
         rf"(?:will|shall|going to|otherwise|లేకపోతే|లేదంటే|वरना|नहीं तो){GAP}arrest"
         rf"|arrest{GAP}(?:you|చేస్తాం|చేస్తాము|చేస్తారు|చేయబడతారు|करेंगे|कर देंगे|kar denge|warrant)"
         rf"|(?:file|will open|register){GAP}(?:criminal case|case against you)"
         rf"|(?:criminal case|case){GAP}(?:against you|పెడతాం|నమోదు చేస్తాం|file करेंगे|file होगा)"
         rf"|(?:seize|freeze){GAP}account|account{GAP}(?:seize|freeze)",
         "The caller invokes arrest, legal action, or seizure of an account.", kind="legal_pressure"),
    rule("secrecy_isolation", "medium",
         rf"{HIDE}{GAP}{TARGET}|{TARGET}{GAP}{HIDE}|(?:keep|ఉంచండి|रखो){GAP}confidential"
         rf"|confidential{GAP}(?:ఉంచండి|रखो|రাখండి)",
         "The speaker asks the recipient to keep the conversation secret or avoid involving others.",
         directive=True),
    rule("financial_manipulation", "high", rf"{PAY}{WIDE}safe account|safe account{WIDE}{PAY}",
         "The speaker directs a transfer to a supposedly safe account.", kind="safe_account"),
    rule("financial_manipulation", "high",
         rf"{PAY}{GAP}{FUNDS}{GAP}{TIME}|{TIME}{GAP}{PAY}{GAP}{FUNDS}"
         rf"|{TIME}{GAP}{FUNDS}{GAP}{PAY}|{FUNDS}{GAP}{TIME}{GAP}{PAY}|{FUNDS}{GAP}{PAY}{GAP}{TIME}",
         "An urgent transfer reinforces another pressure signal.", kind="urgent_transfer"),
    rule("financial_manipulation", "high",
         rf"{PAY}{GAP}(?:to avoid|or else|otherwise|లేకపోతే|वरना)",
         "The speaker ties payment to a consequence.", kind="payment_demand"),
    rule("credential_theft", "high",
         rf"{REQUEST}{GAP}{SECRET}|{SECRET}{GAP}{REQUEST}",
         "The speaker asks for a one-time code or other banking credential.", kind="credential_request"),
    rule("urgency", "medium",
         rf"account{GAP}block|block{GAP}account",
         "The speaker puts pressure on the recipient with an account-blocking claim.", kind="account_pressure"),
    rule("urgency", "medium",
         rf"{TIME}{GAP}(?:verify|verification)|(?:verify|verification){GAP}{TIME}|(?:only|just) \d+ minutes|limited time",
         "A deadline reinforces another demand.", kind="generic_deadline"),
    rule("parcel_scam", "medium",
         rf"(?:illegal|drugs){WIDE}(?:parcel|courier)|"
         rf"(?:parcel|courier|customs){WIDE}(?:illegal|drugs|contraband)",
         "The speaker links a parcel or customs claim to illegal goods."),
    rule("coercion", "high", CALL_CONTROL,
         "The speaker pressures the recipient to keep the call open or threatens them for disconnecting.",
         directive=True, kind="call_control"),
)

DISCONNECT = rule(
    "coercion", "high",
    rf"(?:if you|మీరు){GAP}{HANG}{WIDE}{ARREST_THREAT}|{ARREST_THREAT}{WIDE}(?:if you|మీరు){GAP}{HANG}",
    "Arrest is threatened as a consequence of ending the call.", kind="disconnect_threat",
)
QUOTED = re.compile(r"""“[^”]*”|"[^"]*"|‘[^’]*’|(?<!\w)'[^'\r\n]+'(?!\w)""")
REPORT = re.compile(
    r"(?<!\S)(?:read|heard|learned|talk|talking|article|news|example|story|example of) "
    r"(?:[^ ]+ ){0,6}(?:scam|fraud|digital arrest)(?!\S)"
    r"|(?<!\S)(?:he|she|they|the caller|the scammer|someone|the bank|the police|the officer) "
    r"(?:said|says|told|tells|claimed|asked|reported)(?!\S)"
    r"|(?<!\S)(?:i|we) (?:was|were) (?:told|asked|warned)(?!\S)"
)
REPORT_INTRO = re.compile(r"(?:said|says|told me|tells me|claimed|asked me|warned)(?: that)?$")
INCOMPLETE = re.compile(rf"(?:^| )(?:to|me|your|the|my|for|be|send|transfer|share|tell|pay|give|provide|ask|verify|{PROHIBITION})$")
CONTINUATION_RULES = tuple(candidate for candidate in RULES if candidate.kind in {
    "direct_arrest", "safe_account", "payment_demand", "credential_request", "payment_threat", "call_control",
})
BENIGN_SECRECY = re.compile(r"(?<!\S)(?:birthday|party|surprise|gift|present|retirement|పుట్టినరోజు|जन्मदिन)(?!\S)")
BENIGN_HOLD = re.compile(r"^(?:while|until) (?:i|we) (?:find|look for|get|grab|check|write|open|answer|look up)(?!\S)")
INFORMATIONAL = re.compile(r"(?<!\S)(?:what|why|how|whether|if)(?!\S)")
OWN_LOGIN = re.compile(r"^(?:for )?(?:my own login|my login|my own account login|a test)(?!\S)")
NEGATION = re.compile(rf"(?<!\S){NEGATIVE}(?!\S)")
COMPLETED_DIRECTIVE = re.compile(rf"(?<!\S)(?:{HIDE}{GAP}{TARGET}|{TARGET}{GAP}{HIDE}|{CALL_CONTROL})(?!\S)")
NEXT_DIRECTIVE = re.compile(rf"^(?:{HIDE}{GAP}{TARGET}|{CALL_CONTROL}|{PROHIBITION} (?:{PAY}|{REQUEST}))(?!\S)")


def contextual_match(candidate: Rule, text: str, match: re.Match[str]) -> bool:
    after = text[match.end():].strip()
    before = text[:match.start()].strip()
    category = candidate.category
    if category == "secrecy_isolation":
        if BENIGN_SECRECY.search(match.group() + " " + after):
            return False
        if re.match(rf"^(?:(?:your|the|my) )?{SECRET}(?!\S)", after):
            return False  # A non-disclosure instruction about a credential is safety advice.
    if category == "coercion" and BENIGN_HOLD.search(after):
        return False
    if category == "credential_theft":
        if INFORMATIONAL.search(match.group()) or OWN_LOGIN.search(after):
            return False
        if re.search(r"(?<!\S)(?:what|where|why|how|whether)(?!\S)", " ".join(before.split()[-4:])):
            return False
    if candidate.kind == "generic_deadline" and re.match(r"(?:only|just) \d+ minutes", match.group()):
        if not re.search(r"(?:^| )you have$", before) and not re.match(r"left to (?:pay|send|verify|transfer)", after):
            return False
    if candidate.kind == "account_pressure" and not re.search(
        r"(?<!\S)(?:will|shall|going to|చేస్తాం|అవుతుంది|होगा|कर देंगे)(?!\S)", match.group() + " " + after
    ):
        return False
    return not is_denied(text, match, candidate.directive)


def is_denied(text: str, match: re.Match[str], directive: bool) -> bool:
    before = text[:match.start()]
    after = text[match.end():].strip()
    # ASR can omit punctuation between independent commands. A completed directive
    # retains its own negation instead of vetoing the next matched command.
    completed = list(COMPLETED_DIRECTIVE.finditer(before))
    if completed:
        before = before[completed[-1].end():]
    # Look for scoped negative markers immediately around the claim, including suffix orders in Hindi/Telugu.
    preceding = " ".join(before.split()[-3:])
    if NEGATION.search(preceding) or (
        re.match(rf"{NEGATIVE}(?: |$)", after) and not NEXT_DIRECTIVE.match(after)
    ):
        return True
    return not directive and bool(NEGATION.search(match.group()))


def clause_text(tokens: tuple[Token, ...]) -> tuple[str, dict[int, Token], dict[int, Token]]:
    starts, ends = {}, {}
    cursor = 0
    for token in tokens:
        starts[cursor] = token
        cursor += len(token.text)
        ends[cursor] = token
        cursor += 1
    return " ".join(token.text for token in tokens), starts, ends


def extract_cues(transcript: NormalizedTranscript, can_join: Callable[[int, int, int], bool]) -> list[Cue]:
    cues: list[Cue] = []
    quoted = [(match.start(), match.end()) for match in QUOTED.finditer(transcript.original)]
    previous_report = False
    for index, tokens in enumerate(transcript.clauses):
        text, starts, ends = clause_text(tokens)
        if previous_report or REPORT.search(text):
            previous_report = bool(REPORT_INTRO.search(text))
            continue
        previous_report = False
        cues.extend(match_rules(transcript, tokens, text, starts, ends, (*RULES, DISCONNECT), quoted, index, index))
        if index + 1 < len(transcript.clauses):
            following = transcript.clauses[index + 1]
            between = transcript.original[tokens[-1].end:following[0].start]
            if (re.fullmatch(r"[,\s]*", between) and can_join(tokens[-1].end, following[0].start, 12_000)
                    and not REPORT.search(" ".join(token.text for token in following))):
                joint = tokens + following
                merged, joint_starts, joint_ends = clause_text(joint)
                rules = (DISCONNECT, *CONTINUATION_RULES) if INCOMPLETE.search(text) else (DISCONNECT,)
                cues.extend(match_rules(transcript, joint, merged, joint_starts, joint_ends,
                                        rules, quoted, index, index + 1))
    return cues


def match_rules(
    transcript: NormalizedTranscript, tokens: tuple[Token, ...], text: str,
    starts: dict[int, Token], ends: dict[int, Token], rules: tuple[Rule, ...],
    quoted: list[tuple[int, int]], first: int, last: int,
) -> Iterator[Cue]:
    for candidate in rules:
        for match in candidate.pattern.finditer(text):
            start, end = starts[match.start()].start, ends[match.end()].end
            if first != last and not (start < transcript.clauses[last][0].start < end):
                continue
            if any(start < quote_end and end > quote_start for quote_start, quote_end in quoted):
                continue
            if not contextual_match(candidate, text, match):
                continue
            yield Cue(Signal(
                category=candidate.category, severity=candidate.severity,
                evidence=transcript.original[start:end], start=start, end=end,
                match_quality="normalized_variant" if any(
                    token.aliased and start <= token.start < end for token in tokens
                ) else "direct",
                explanation=candidate.explanation,
            ), candidate.kind, first, last)
