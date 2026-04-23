from typing import Any

from fastapi import APIRouter


router = APIRouter()
_views: list[dict[str, Any]] = []


@router.get("/api/views")
def list_views() -> list[dict[str, Any]]:
    return _views


@router.post("/api/views")
def create_view(payload: dict[str, Any]) -> dict[str, Any]:
    _views.append(payload)
    return payload
