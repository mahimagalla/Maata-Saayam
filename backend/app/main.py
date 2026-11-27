from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from .scam.api import router as analysis_router

app = FastAPI(title="Maata-Saayam")
app.include_router(analysis_router)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


@app.get("/api/health")
def health() -> HealthResponse:
    return HealthResponse()
