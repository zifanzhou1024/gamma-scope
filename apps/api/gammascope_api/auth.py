from __future__ import annotations

import os
import secrets

from fastapi import HTTPException, WebSocket


ADMIN_TOKEN_ENV = "GAMMASCOPE_ADMIN_TOKEN"
PRIVATE_MODE_ENABLED_ENV = "GAMMASCOPE_PRIVATE_MODE_ENABLED"
PRIVATE_MODE_LEGACY_ENV = "GAMMASCOPE_PRIVATE_MODE"
ADMIN_TOKEN_HEADER = "X-GammaScope-Admin-Token"
ADMIN_TOKEN_QUERY_PARAM = "admin_token"

_TRUTHY_VALUES = {"1", "true", "yes", "on", "enabled"}


def private_mode_enabled() -> bool:
    return _truthy_env(PRIVATE_MODE_ENABLED_ENV) or _truthy_env(PRIVATE_MODE_LEGACY_ENV)


def admin_token_configured() -> str:
    return os.environ.get(ADMIN_TOKEN_ENV, "").strip()


def is_valid_admin_token(token: str | None) -> bool:
    configured_token = admin_token_configured()
    if not configured_token or token is None:
        return False
    return secrets.compare_digest(token, configured_token)


def require_admin_token(token: str | None) -> None:
    if not is_valid_admin_token(token):
        raise HTTPException(status_code=403, detail="Admin token required")


def require_private_mode_admin_token(token: str | None) -> None:
    if private_mode_enabled():
        require_admin_token(token)


def can_read_live_state(token: str | None) -> bool:
    return not private_mode_enabled() or is_valid_admin_token(token)


def websocket_admin_token(websocket: WebSocket) -> str | None:
    return websocket.headers.get(ADMIN_TOKEN_HEADER) or websocket.query_params.get(ADMIN_TOKEN_QUERY_PARAM)


def _truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUTHY_VALUES
