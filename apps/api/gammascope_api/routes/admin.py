from __future__ import annotations

import os
import secrets
from typing import Any

from fastapi import APIRouter, Header, HTTPException

from gammascope_api.maintenance.retention import RetentionCleanupUnavailable, cleanup_retention


router = APIRouter()


@router.post("/api/admin/retention/cleanup")
def cleanup_retention_route(
    dry_run: bool = True,
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict[str, Any]:
    if not dry_run:
        _require_admin_token(x_gammascope_admin_token)
    try:
        return cleanup_retention(dry_run=dry_run)
    except RetentionCleanupUnavailable as exc:
        raise HTTPException(status_code=503, detail="Retention cleanup persistence unavailable") from exc


def _require_admin_token(token: str | None) -> None:
    configured_token = os.environ.get("GAMMASCOPE_ADMIN_TOKEN", "").strip()
    if not configured_token or token is None:
        raise HTTPException(status_code=403, detail="Admin token required")
    if not secrets.compare_digest(token, configured_token):
        raise HTTPException(status_code=403, detail="Admin token required")
