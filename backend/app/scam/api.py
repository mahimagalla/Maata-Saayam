from fastapi import APIRouter, Response
from pydantic import BaseModel, Field, model_validator

from .engine import AnalysisResult, Language, TranscriptFragment, analyze

router = APIRouter(prefix="/api")


class AnalysisRequest(BaseModel):
    transcript: str | None = Field(default=None, max_length=20_000)
    fragments: tuple[TranscriptFragment, ...] | None = Field(default=None, min_length=1, max_length=8)
    language: Language
    session_id: str | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def validate_input(self):
        if (self.transcript is None) == (self.fragments is None):
            raise ValueError("Provide a transcript or finalized fragments")
        if self.fragments:
            if len({fragment.id for fragment in self.fragments}) != len(self.fragments):
                raise ValueError("Fragment IDs must be unique")
            times = [fragment.finalized_at_ms for fragment in self.fragments]
            if times != sorted(times):
                raise ValueError("Fragments must be ordered by finalization time")
        return self


@router.post("/analyze", response_model=AnalysisResult)
def analyze_transcript(request: AnalysisRequest, response: Response) -> AnalysisResult:
    response.headers["Cache-Control"] = "no-store"
    # Apply all language patterns to every request so code-switching stays visible.
    return analyze(request.transcript or "", fragments=request.fragments or ())
