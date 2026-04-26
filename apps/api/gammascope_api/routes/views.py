from fastapi import APIRouter, Header

from gammascope_api.auth import is_valid_admin_token, live_admin_required, require_admin_token
from gammascope_api.contracts.generated.saved_view import SavedView
from gammascope_api.saved_views.dependencies import (
    degrade_saved_view_repository_to_fallback,
    get_saved_view_repository,
)
from gammascope_api.saved_views.repository import SavedViewRepository


router = APIRouter()


@router.get("/api/views", response_model=list[SavedView])
def list_views(x_gammascope_admin_token: str | None = Header(default=None)) -> list[SavedView]:
    repository = _available_repository()
    try:
        views = repository.list_views()
    except Exception:
        views = degrade_saved_view_repository_to_fallback().list_views()
    if live_admin_required() and not is_valid_admin_token(x_gammascope_admin_token):
        views = [view for view in views if view.get("owner_scope") == "public_demo"]
    return [SavedView.model_validate(view) for view in views]


@router.post("/api/views", response_model=SavedView)
def create_view(
    payload: SavedView,
    x_gammascope_admin_token: str | None = Header(default=None),
) -> SavedView:
    if live_admin_required() and payload.owner_scope.value == "admin":
        require_admin_token(x_gammascope_admin_token)
    repository = _available_repository()
    normalized = payload.model_dump(mode="json")
    try:
        saved = repository.save_view(normalized)
    except Exception:
        saved = degrade_saved_view_repository_to_fallback().save_view(normalized)
    return SavedView.model_validate(saved)


def _available_repository() -> SavedViewRepository:
    repository = get_saved_view_repository()
    try:
        repository.ensure_schema()
    except Exception:
        return degrade_saved_view_repository_to_fallback()
    return repository
