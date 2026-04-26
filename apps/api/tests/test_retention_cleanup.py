from __future__ import annotations

from fastapi.testclient import TestClient

from gammascope_api.maintenance import retention
from gammascope_api.main import app
from gammascope_api.replay.dependencies import reset_replay_repository_override, set_replay_repository_override
from gammascope_api.replay.repository import NullReplayRepository
from gammascope_api.saved_views.dependencies import (
    reset_saved_view_repository_override,
    set_saved_view_repository_override,
)
from gammascope_api.saved_views.repository import InMemorySavedViewRepository


client = TestClient(app)


def teardown_function() -> None:
    reset_replay_repository_override()
    reset_saved_view_repository_override()


def test_retention_cleanup_defaults_to_dry_run_and_reports_counts(monkeypatch) -> None:
    replay_repository = CleanupReplayRepository()
    saved_view_repository = CleanupSavedViewRepository()
    set_replay_repository_override(replay_repository)
    set_saved_view_repository_override(saved_view_repository)
    monkeypatch.delenv("GAMMASCOPE_HOSTED_REPLAY_MODE", raising=False)
    monkeypatch.delenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", raising=False)
    monkeypatch.delenv("GAMMASCOPE_PRIVATE_MODE", raising=False)
    monkeypatch.setenv("GAMMASCOPE_REPLAY_RETENTION_DAYS", "20")
    monkeypatch.setenv("GAMMASCOPE_SAVED_VIEW_RETENTION_DAYS", "90")

    response = client.post("/api/admin/retention/cleanup")

    assert response.status_code == 200
    payload = response.json()
    assert payload["dry_run"] is True
    assert payload["retention_days"] == {"replay": 20, "saved_views": 90}
    assert set(payload["cutoffs"]) == {"replay", "saved_views"}
    assert payload["replay"] == {"snapshots_eligible": 3, "sessions_eligible": 1}
    assert payload["saved_views"] == {"views_eligible": 2}
    assert replay_repository.calls == [True]
    assert saved_view_repository.calls == [True]


def test_retention_cleanup_dry_run_requires_admin_token_in_hosted_replay_mode(monkeypatch) -> None:
    replay_repository = CleanupReplayRepository()
    saved_view_repository = CleanupSavedViewRepository()
    set_replay_repository_override(replay_repository)
    set_saved_view_repository_override(saved_view_repository)
    monkeypatch.setenv("GAMMASCOPE_HOSTED_REPLAY_MODE", "true")
    monkeypatch.delenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", raising=False)
    monkeypatch.delenv("GAMMASCOPE_PRIVATE_MODE", raising=False)
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")

    missing_token_response = client.post("/api/admin/retention/cleanup")
    admin_response = client.post(
        "/api/admin/retention/cleanup",
        headers={"X-GammaScope-Admin-Token": "local-admin-token"},
    )

    assert missing_token_response.status_code == 403
    assert admin_response.status_code == 200
    assert admin_response.json()["dry_run"] is True
    assert replay_repository.calls == [True]
    assert saved_view_repository.calls == [True]


def test_retention_cleanup_destructive_without_configured_token_returns_403(monkeypatch) -> None:
    replay_repository = CleanupReplayRepository()
    saved_view_repository = CleanupSavedViewRepository()
    set_replay_repository_override(replay_repository)
    set_saved_view_repository_override(saved_view_repository)
    monkeypatch.delenv("GAMMASCOPE_ADMIN_TOKEN", raising=False)
    monkeypatch.setattr(retention, "_can_cleanup_atomically", lambda replay, saved_views: True)
    monkeypatch.setattr(
        retention,
        "_cleanup_postgres_atomically",
        lambda **kwargs: ({"snapshots": 3, "sessions": 1}, 2),
    )

    response = client.post("/api/admin/retention/cleanup", params={"dry_run": "false"})

    assert response.status_code == 403
    assert replay_repository.calls == []
    assert saved_view_repository.calls == []


def test_retention_cleanup_destructive_blank_configured_token_returns_403(monkeypatch) -> None:
    replay_repository = CleanupReplayRepository()
    saved_view_repository = CleanupSavedViewRepository()
    set_replay_repository_override(replay_repository)
    set_saved_view_repository_override(saved_view_repository)
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "   ")
    monkeypatch.setattr(retention, "_can_cleanup_atomically", lambda replay, saved_views: True)
    monkeypatch.setattr(
        retention,
        "_cleanup_postgres_atomically",
        lambda **kwargs: ({"snapshots": 3, "sessions": 1}, 2),
    )

    response = client.post(
        "/api/admin/retention/cleanup",
        params={"dry_run": "false"},
        headers={"X-GammaScope-Admin-Token": "anything"},
    )

    assert response.status_code == 403
    assert replay_repository.calls == []
    assert saved_view_repository.calls == []


def test_retention_cleanup_destructive_missing_token_returns_403(monkeypatch) -> None:
    replay_repository = CleanupReplayRepository()
    saved_view_repository = CleanupSavedViewRepository()
    set_replay_repository_override(replay_repository)
    set_saved_view_repository_override(saved_view_repository)
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")
    monkeypatch.setattr(retention, "_can_cleanup_atomically", lambda replay, saved_views: True)
    monkeypatch.setattr(
        retention,
        "_cleanup_postgres_atomically",
        lambda **kwargs: ({"snapshots": 3, "sessions": 1}, 2),
    )

    response = client.post("/api/admin/retention/cleanup", params={"dry_run": "false"})

    assert response.status_code == 403
    assert replay_repository.calls == []
    assert saved_view_repository.calls == []


def test_retention_cleanup_destructive_wrong_token_returns_403(monkeypatch) -> None:
    replay_repository = CleanupReplayRepository()
    saved_view_repository = CleanupSavedViewRepository()
    set_replay_repository_override(replay_repository)
    set_saved_view_repository_override(saved_view_repository)
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")
    monkeypatch.setattr(retention, "_can_cleanup_atomically", lambda replay, saved_views: True)
    monkeypatch.setattr(
        retention,
        "_cleanup_postgres_atomically",
        lambda **kwargs: ({"snapshots": 3, "sessions": 1}, 2),
    )

    response = client.post(
        "/api/admin/retention/cleanup",
        params={"dry_run": "false"},
        headers={"X-GammaScope-Admin-Token": "wrong-token"},
    )

    assert response.status_code == 403
    assert replay_repository.calls == []
    assert saved_view_repository.calls == []


def test_retention_cleanup_executes_atomically_only_when_dry_run_false(monkeypatch) -> None:
    replay_repository = CleanupReplayRepository()
    saved_view_repository = CleanupSavedViewRepository()
    set_replay_repository_override(replay_repository)
    set_saved_view_repository_override(saved_view_repository)
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")
    monkeypatch.setattr(retention, "_can_cleanup_atomically", lambda replay, saved_views: True)
    monkeypatch.setattr(
        retention,
        "_cleanup_postgres_atomically",
        lambda **kwargs: ({"snapshots": 3, "sessions": 1}, 2),
    )

    response = client.post(
        "/api/admin/retention/cleanup",
        params={"dry_run": "false"},
        headers={"X-GammaScope-Admin-Token": "local-admin-token"},
    )

    assert response.status_code == 200
    assert response.json()["dry_run"] is False
    assert response.json()["replay"] == {"snapshots_deleted": 3, "sessions_deleted": 1}
    assert response.json()["saved_views"] == {"views_deleted": 2}
    assert replay_repository.calls == [True]
    assert saved_view_repository.calls == [True]


def test_retention_cleanup_returns_503_when_postgres_cleanup_is_unavailable(monkeypatch) -> None:
    set_replay_repository_override(NullReplayRepository())
    set_saved_view_repository_override(InMemorySavedViewRepository())
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")

    response = client.post(
        "/api/admin/retention/cleanup",
        params={"dry_run": "false"},
        headers={"X-GammaScope-Admin-Token": "local-admin-token"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Retention cleanup persistence unavailable"


def test_retention_cleanup_does_not_delete_replay_when_saved_view_cleanup_is_unavailable(monkeypatch) -> None:
    replay_repository = CleanupReplayRepository()
    saved_view_repository = CleanupFailingSavedViewRepository()
    set_replay_repository_override(replay_repository)
    set_saved_view_repository_override(saved_view_repository)
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")

    response = client.post(
        "/api/admin/retention/cleanup",
        params={"dry_run": "false"},
        headers={"X-GammaScope-Admin-Token": "local-admin-token"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Retention cleanup persistence unavailable"
    assert False not in replay_repository.calls


def test_retention_cleanup_does_not_delete_replay_when_saved_view_destructive_cleanup_fails(monkeypatch) -> None:
    replay_repository = CleanupReplayRepository()
    saved_view_repository = CleanupDestructiveFailingSavedViewRepository()
    set_replay_repository_override(replay_repository)
    set_saved_view_repository_override(saved_view_repository)
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")

    response = client.post(
        "/api/admin/retention/cleanup",
        params={"dry_run": "false"},
        headers={"X-GammaScope-Admin-Token": "local-admin-token"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Retention cleanup persistence unavailable"
    assert False not in replay_repository.calls
    assert saved_view_repository.calls == [True]


class CleanupReplayRepository:
    database_url = "postgresql://example/gammascope"

    def __init__(self) -> None:
        self.calls: list[bool] = []

    def ensure_schema(self) -> None:
        return None

    def cleanup_before(self, cutoff, *, dry_run: bool) -> dict[str, int]:
        self.calls.append(dry_run)
        return {"snapshots": 3, "sessions": 1}


class CleanupSavedViewRepository:
    database_url = "postgresql://example/gammascope"

    def __init__(self) -> None:
        self.calls: list[bool] = []

    def ensure_schema(self) -> None:
        return None

    def cleanup_before(self, cutoff, *, dry_run: bool) -> int:
        self.calls.append(dry_run)
        return 2


class CleanupFailingSavedViewRepository:
    def ensure_schema(self) -> None:
        return None

    def cleanup_before(self, cutoff, *, dry_run: bool) -> int:
        raise RuntimeError("saved view cleanup unavailable")


class CleanupDestructiveFailingSavedViewRepository:
    def __init__(self) -> None:
        self.calls: list[bool] = []

    def ensure_schema(self) -> None:
        return None

    def cleanup_before(self, cutoff, *, dry_run: bool) -> int:
        self.calls.append(dry_run)
        if not dry_run:
            raise RuntimeError("saved view destructive cleanup unavailable")
        return 2
