"""Normalize recognition text while keeping character offsets into the input."""

import re
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass

from .lexicon import ALIASES

TOKEN = re.compile(r"[^\W_]", re.UNICODE)
BOUNDARY = re.compile(r"[,.!?;।॥\r\n]+")
SPEAKER = re.compile(r"^\s*(?:[A-Z]|caller|speaker\s+\d+|elder|guardian|recipient)\s*:\s*", re.I)


@dataclass(frozen=True)
class Token:
    text: str
    start: int
    end: int
    aliased: bool = False


@dataclass(frozen=True)
class NormalizedTranscript:
    original: str
    clauses: tuple[tuple[Token, ...], ...]
    duplicates_removed: int

    @property
    def text(self) -> str:
        return "\n".join(" ".join(token.text for token in clause) for clause in self.clauses)


def words(text: str, offset: int = 0) -> list[Token]:
    tokens = []
    start: int | None = None
    for index, character in enumerate(text):
        is_word = TOKEN.fullmatch(character) or unicodedata.category(character).startswith("M")
        joins_word = character in "'’\u200c\u200d" and start is not None
        if start is None and is_word:
            start = index
        elif start is not None and not (is_word or joins_word):
            tokens.append(make_token(text, start, index, offset))
            start = None
    if start is not None:
        tokens.append(make_token(text, start, len(text), offset))
    return tokens


def make_token(text: str, start: int, end: int, offset: int) -> Token:
    value = unicodedata.normalize("NFKC", text[start:end]).casefold()
    value = value.replace("’", "'").replace("\u200c", "").replace("\u200d", "")
    return Token(value, start + offset, end + offset)


VARIANTS = {
    tuple(token.text for token in words(variant)): canonical
    for canonical, variants in ALIASES.items()
    for variant in variants
}
MAX_ALIAS_WORDS = max(map(len, VARIANTS))
REPEATABLE = frozenset({"please", "otp", "kyc", "police", "account", "send", "share", "money", "transfer", "arrest", "immediately"})


def apply_aliases(tokens: list[Token]) -> tuple[Token, ...]:
    output: list[Token] = []
    cursor = 0
    while cursor < len(tokens):
        for size in range(min(MAX_ALIAS_WORDS, len(tokens) - cursor), 0, -1):
            span = tokens[cursor:cursor + size]
            canonical = VARIANTS.get(tuple(token.text for token in span))
            if canonical is not None:
                output.extend(Token(part, span[0].start, span[-1].end,
                                    " ".join(token.text for token in span) != canonical.casefold())
                              for part in canonical.split())
                cursor += size
                break
        else:
            output.append(tokens[cursor])
            cursor += 1
    return tuple(output)


def normalize(transcript: str) -> NormalizedTranscript:
    clauses: list[tuple[Token, ...]] = []
    duplicates = 0
    previous: tuple[str, ...] = ()
    start = 0
    for boundary in (*BOUNDARY.finditer(transcript), None):
        end = boundary.start() if boundary else len(transcript)
        segment = transcript[start:end]
        speaker = SPEAKER.match(segment)
        if speaker:
            start += speaker.end()
            segment = segment[speaker.end():]
        tokens = apply_aliases(words(segment, start))
        # Keep discourse boundaries so a nearby negation cannot leak into a contrasting clause.
        for clause in split_contrasts(tokens):
            collapsed: list[Token] = []
            for token in clause:
                if (collapsed and token.text == collapsed[-1].text
                        and token.text.casefold() in REPEATABLE):
                    duplicates += 1
                    continue
                collapsed.append(token)
            signature = tuple(token.text for token in collapsed)
            # Adjacent full clauses only. Independent and nonadjacent turns stay visible.
            if signature and signature == previous and not speaker and len(signature) >= 3:
                duplicates += 1
            elif signature:
                clauses.append(tuple(collapsed))
                previous = signature
        if boundary:
            start = boundary.end()
    return NormalizedTranscript(transcript, tuple(clauses), duplicates)


def split_contrasts(tokens: tuple[Token, ...]) -> Iterator[tuple[Token, ...]]:
    start = 0
    for index, token in enumerate(tokens):
        if token.text == "but":
            yield tokens[start:index]
            start = index  # Keep the discourse marker in the normalized text.
    yield tokens[start:]
