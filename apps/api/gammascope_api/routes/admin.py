from typing import Any

from fastapi import APIRouter, Header, HTTPException

from gammascope_api.auth import require_admin_token
from gammascope_api.maintenance.retention import RetentionCleanupUnavailable, cleanup_retention


router = APIRouter()


@router.post("/api/admin/retention/cleanup")
def cleanup_retention_route(
    dry_run: bool = True,
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict[str, Any]:
    if not dry_run:
        require_admin_token(x_gammascope_admin_token)
    try:
        return cleanup_retention(dry_run=dry_run)
    except RetentionCleanupUnavailable as exc:
        raise HTTPException(status_code=503, detail="Retention cleanup persistence unavailable") from exc
