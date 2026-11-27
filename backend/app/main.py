from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from .scam.api import router as analysis_router
from .family.api import create_family_router
from .family.store import MemoryFamilyStore

app = FastAPI(title="Maata-Saayam")
app.include_router(analysis_router)
app.include_router(create_family_router(MemoryFamilyStore()))


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


@app.get("/api/health")
def health() -> HealthResponse:
    return HealthResponse()
