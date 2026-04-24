from fastapi import APIRouter

from gammascope_api.contracts.generated.saved_view import SavedView


router = APIRouter()
_views: list[SavedView] = []


@router.get("/api/views", response_model=list[SavedView])
def list_views() -> list[SavedView]:
    return _views


@router.post("/api/views", response_model=SavedView)
def create_view(payload: SavedView) -> SavedView:
    _views.append(payload)
    return payload
