from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request as StarletteRequest
from starlette.websockets import WebSocketDisconnect

from gammascope_api.main import app
from gammascope_api.replay.dependencies import (
    get_replay_parquet_importer,
    reset_replay_import_repository_override,
    reset_replay_repository_override,
    set_replay_import_repository_override,
    set_replay_repository_override,
)
from gammascope_api.replay import baseline
from gammascope_api.replay.import_repository import ImportedSnapshotData, ImportedSnapshotHeader
from gammascope_api.replay.importer import ImportResult
from gammascope_api.replay.parquet_reader import QuoteRecord
from gammascope_api.replay.repository import NullReplayRepository
from gammascope_api.routes import replay_imports

from replay_parquet_fixtures import write_replay_parquet_pair


ADMIN_TOKEN = "route-test-admin-token"


@pytest.fixture()
def importer_override(monkeypatch: pytest.MonkeyPatch) -> "_FakeImporter":
    importer = _FakeImporter()
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", ADMIN_TOKEN)
    monkeypatch.delenv("GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES", raising=False)
    app.dependency_overrides[get_replay_parquet_importer] = lambda: importer
    yield importer
    app.dependency_overrides.pop(get_replay_parquet_importer, None)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def public_replay_client() -> tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"]:
    import_repository = _FakeReplayImportRepository()
    replay_repository = _FakeReplayRepository()
    set_replay_import_repository_override(import_repository)
    set_replay_repository_override(replay_repository)
    try:
        yield TestClient(app), import_repository, replay_repository
    finally:
        reset_replay_import_repository_override()
        reset_replay_repository_override()


def test_local_baseline_import_returns_none_when_files_are_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snapshots_path = tmp_path / ".gammascope" / "replay-baselines" / "2026-04-22" / "snapshots.parquet"
    quotes_path = snapshots_path.parent / "quotes.parquet"
    importer = _FakeImporter()
    monkeypatch.setattr(baseline, "replay_baseline_paths", lambda: (snapshots_path, quotes_path))

    result = baseline.import_local_baseline_if_present(importer)

    assert result is None
    assert importer.create_calls == []
    assert importer.confirm_calls == []


def test_local_baseline_import_confirms_present_baseline_and_returns_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snapshots_path = tmp_path / ".gammascope" / "replay-baselines" / "2026-04-22" / "snapshots.parquet"
    quotes_path = snapshots_path.parent / "quotes.parquet"
    snapshots_path.parent.mkdir(parents=True)
    snapshots_path.write_bytes(b"snapshot bytes")
    quotes_path.write_bytes(b"quote bytes")
    importer = _FakeImporter()
    importer.create_result = _result(status="awaiting_confirmation", import_id="baseline-import")
    importer.confirm_results["baseline-import"] = _result(
        status="completed",
        import_id="baseline-import",
        replay_url="/replay?session_id=session-ready",
    )
    monkeypatch.setattr(baseline, "replay_baseline_paths", lambda: (snapshots_path, quotes_path))

    result = baseline.import_local_baseline_if_present(importer)

    assert result == importer.confirm_results["baseline-import"]
    assert importer.create_calls == [
        {
            "snapshots_path": snapshots_path,
            "quotes_path": quotes_path,
        }
    ]
    assert importer.confirm_calls == ["baseline-import"]


def test_local_baseline_import_returns_existing_completed_session_when_checksums_match(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snapshots_path = tmp_path / ".gammascope" / "replay-baselines" / "2026-04-22" / "snapshots.parquet"
    quotes_path = snapshots_path.parent / "quotes.parquet"
    snapshots_path.parent.mkdir(parents=True)
    snapshots_path.write_bytes(b"snapshot bytes")
    quotes_path.write_bytes(b"quote bytes")
    importer = _FakeImporter()
    first_completed = _result(
        status="completed",
        import_id="baseline-import-first",
        session_id="existing-session",
        replay_url="/replay?session_id=existing-session",
    )
    existing_completed = _result(
        status="completed",
        import_id="baseline-import-existing",
        session_id="existing-session",
        replay_url="/replay?session_id=existing-session",
    )
    importer.create_results = [
        _result(status="awaiting_confirmation", import_id="baseline-import-first"),
        existing_completed,
    ]
    importer.confirm_results["baseline-import-first"] = first_completed
    monkeypatch.setattr(baseline, "replay_baseline_paths", lambda: (snapshots_path, quotes_path))

    first = baseline.import_local_baseline_if_present(importer)
    second = baseline.import_local_baseline_if_present(importer)

    assert first == first_completed
    assert second == existing_completed
    assert len(importer.create_calls) == 2
    assert importer.confirm_calls == ["baseline-import-first"]


def test_upload_requires_admin_token(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    response = client.post("/api/replay/imports", files=_upload_files(tmp_path))

    assert response.status_code == 403
    assert importer_override.create_calls == []


def test_upload_rejects_wrong_admin_token(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    response = client.post(
        "/api/replay/imports",
        headers={"X-GammaScope-Admin-Token": "wrong"},
        files=_upload_files(tmp_path),
    )

    assert response.status_code == 403
    assert importer_override.create_calls == []


def test_upload_authenticates_before_parsing_multipart(
    importer_override: "_FakeImporter",
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail_if_form_is_parsed(self: StarletteRequest, *_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("multipart form parsed before admin authentication")

    monkeypatch.setattr(StarletteRequest, "form", fail_if_form_is_parsed)
    guarded_client = TestClient(app, raise_server_exceptions=False)

    response = guarded_client.post("/api/replay/imports", files=_upload_files(tmp_path))

    assert response.status_code == 403
    assert importer_override.create_calls == []


def test_upload_requires_exactly_snapshots_and_quotes_file_fields(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    missing_response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path, include_quotes=False),
    )
    extra_response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=[
            *_upload_files(tmp_path),
            ("other", ("other.parquet", b"other bytes", "application/octet-stream")),
        ],
    )

    assert missing_response.status_code == 400
    assert extra_response.status_code == 400
    assert importer_override.create_calls == []


def test_upload_rejects_duplicate_file_fields_before_import_record(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path)

    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=[
            ("snapshots", ("snapshots.parquet", snapshots_path.read_bytes(), "application/octet-stream")),
            ("snapshots", ("snapshots.parquet", snapshots_path.read_bytes(), "application/octet-stream")),
            ("quotes", ("quotes.parquet", quotes_path.read_bytes(), "application/octet-stream")),
        ],
    )

    assert response.status_code == 400
    assert importer_override.create_calls == []


def test_upload_rejects_extra_text_fields_before_import_record(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path),
        data={"notes": "do not accept sidecar fields"},
    )

    assert response.status_code == 400
    assert importer_override.create_calls == []


def test_upload_rejects_wrong_filenames_before_import_record(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path, snapshots_filename="snapshot-upload.parquet"),
    )

    assert response.status_code == 400
    assert importer_override.create_calls == []


def test_upload_rejects_duplicate_same_file_checksums_before_import_record(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    same_bytes = b"not really parquet, but same upload bytes"

    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=[
            ("snapshots", ("snapshots.parquet", same_bytes, "application/octet-stream")),
            ("quotes", ("quotes.parquet", same_bytes, "application/octet-stream")),
        ],
    )

    assert response.status_code == 400
    assert importer_override.create_calls == []


def test_upload_rejects_oversize_file_before_import_record(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES", "8")

    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path),
    )

    assert response.status_code == 413
    assert importer_override.create_calls == []


def test_upload_rejects_oversize_file_without_leaking_temp_directory(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    temp_root = tmp_path / "temp-root"
    temp_root.mkdir()
    monkeypatch.setenv("GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES", "8")
    monkeypatch.setattr(replay_imports.tempfile, "tempdir", str(temp_root))

    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path),
    )

    assert response.status_code == 413
    assert importer_override.create_calls == []
    assert list(temp_root.glob("gammascope-replay-import-*")) == []


def test_upload_rejects_oversize_body_before_post_parse_copy(
    importer_override: "_FakeImporter",
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail_if_post_parse_copy_runs(*_args: Any, **_kwargs: Any) -> int:
        raise AssertionError("oversize body reached post-parse copy")

    monkeypatch.setenv("GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES", "16")
    monkeypatch.setattr(replay_imports, "copy_upload_with_limit", fail_if_post_parse_copy_runs)
    guarded_client = TestClient(app, raise_server_exceptions=False)

    response = guarded_client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=[
            ("snapshots", ("snapshots.parquet", b"s" * (70 * 1024), "application/octet-stream")),
            ("quotes", ("quotes.parquet", b"quote bytes", "application/octet-stream")),
        ],
    )

    assert response.status_code == 413
    assert importer_override.create_calls == []


def test_successful_upload_returns_import_result_shape(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    importer_override.create_result = _result(status="awaiting_confirmation", import_id="import-ready")

    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path),
    )

    assert response.status_code in {200, 202}
    assert response.json() == {
        "import_id": "import-ready",
        "status": "awaiting_confirmation",
        "summary": {"snapshot_count": 3},
        "warnings": [],
        "errors": [],
        "session_id": "session-ready",
        "replay_url": None,
    }
    assert len(importer_override.create_calls) == 1
    assert importer_override.create_calls[0]["snapshots_path"].name == "snapshots.parquet"
    assert importer_override.create_calls[0]["quotes_path"].name == "quotes.parquet"


def test_schema_validation_failure_after_import_record_returns_failed_result(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    importer_override.create_result = _result(
        import_id="import-failed",
        status="failed",
        errors=["missing required parquet column: snapshot_id"],
        session_id=None,
    )

    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path),
    )

    assert response.status_code == 200
    assert response.json()["import_id"] == "import-failed"
    assert response.json()["status"] == "failed"
    assert response.json()["errors"] == ["missing required parquet column: snapshot_id"]
    assert len(importer_override.create_calls) == 1


def test_get_import_returns_current_result_shape(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.imports["import-ready"] = _result(status="awaiting_confirmation", import_id="import-ready")

    response = client.get("/api/replay/imports/import-ready", headers=_admin_headers())

    assert response.status_code == 200
    assert response.json()["import_id"] == "import-ready"
    assert response.json()["status"] == "awaiting_confirmation"
    assert response.json()["summary"] == {"snapshot_count": 3}


def test_get_missing_import_returns_404(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    response = client.get("/api/replay/imports/missing-import", headers=_admin_headers())

    assert response.status_code == 404


def test_confirm_awaiting_import_returns_completed(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.confirm_results["import-ready"] = _result(
        status="completed",
        import_id="import-ready",
        replay_url="/replay?session_id=session-ready",
    )

    response = client.post("/api/replay/imports/import-ready/confirm", headers=_admin_headers())

    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    assert response.json()["replay_url"] == "/replay?session_id=session-ready"


def test_confirm_completed_import_returns_completed(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.confirm_results["import-completed"] = _result(
        status="completed",
        import_id="import-completed",
        replay_url="/replay?session_id=session-ready",
    )

    response = client.post("/api/replay/imports/import-completed/confirm", headers=_admin_headers())

    assert response.status_code == 200
    assert response.json()["status"] == "completed"


def test_confirm_invalid_state_returns_409(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.confirm_results["import-failed"] = _result(
        status="failed",
        import_id="import-failed",
        errors=["Cannot confirm import from status failed"],
        session_id=None,
    )

    response = client.post("/api/replay/imports/import-failed/confirm", headers=_admin_headers())

    assert response.status_code == 409
    assert response.json()["status"] == "failed"


def test_cancel_unpublished_import_returns_cancelled(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.cancel_results["import-ready"] = _result(
        status="cancelled",
        import_id="import-ready",
        session_id=None,
    )

    response = client.delete("/api/replay/imports/import-ready", headers=_admin_headers())

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


def test_cancel_completed_import_returns_409(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.cancel_results["import-completed"] = _result(
        status="completed",
        import_id="import-completed",
        errors=["Cannot cancel import from status completed"],
        replay_url="/replay?session_id=session-ready",
    )

    response = client.delete("/api/replay/imports/import-completed", headers=_admin_headers())

    assert response.status_code == 409
    assert response.json()["status"] == "completed"


def test_public_replay_sessions_prepend_completed_imports_and_mark_timestamp_source(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, import_repository, _replay_repository = public_replay_client

    response = client.get("/api/spx/0dte/replay/sessions")

    assert response.status_code == 200
    sessions = response.json()
    session_ids = [session["session_id"] for session in sessions]
    assert session_ids[:3] == ["import-session-ready", "live-session-ready", "seed-spx-2026-04-23"]
    assert session_ids.count("import-session-ready") == 1
    assert "import-session-failed" not in session_ids
    assert "import-session-cancelled" not in session_ids
    assert "import-session-awaiting" not in session_ids
    assert sessions[0]["timestamp_source"] == "exact"
    assert sessions[0]["snapshot_count"] == len(import_repository.snapshots)
    assert sessions[1]["timestamp_source"] == "estimated"
    assert sessions[2]["timestamp_source"] == "estimated"
    assert sessions[2]["snapshot_count"] == 4


def test_public_replay_session_timestamps_expose_import_source_order_and_estimated_empty(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, import_repository, _replay_repository = public_replay_client

    imported_response = client.get("/api/spx/0dte/replay/sessions/import-session-ready/timestamps")
    live_response = client.get("/api/spx/0dte/replay/sessions/live-session-ready/timestamps")

    assert imported_response.status_code == 200
    assert imported_response.json() == {
        "session_id": "import-session-ready",
        "timestamp_source": "exact",
        "timestamps": [
            {
                "index": snapshot.header.source_order,
                "snapshot_time": snapshot.header.snapshot_time,
                "source_snapshot_id": snapshot.header.source_snapshot_id,
            }
            for snapshot in import_repository.snapshots
        ],
    }
    assert live_response.status_code == 200
    assert live_response.json() == {
        "session_id": "live-session-ready",
        "timestamp_source": "estimated",
        "timestamps": [],
    }


def test_public_replay_snapshot_selects_imported_source_id_and_at_ties_by_source_order(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, _import_repository, _replay_repository = public_replay_client

    duplicate_response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "import-session-ready", "source_snapshot_id": "src-duplicate-later"},
    )
    tied_response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "import-session-ready", "at": "2026-04-24T15:35:00Z"},
    )
    unknown_source_response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "import-session-ready", "source_snapshot_id": "missing-source"},
    )

    assert duplicate_response.status_code == 200
    duplicate_payload = duplicate_response.json()
    assert duplicate_payload["session_id"] == "import-session-ready"
    assert duplicate_payload["snapshot_time"] == "2026-04-24T15:40:00Z"
    assert duplicate_payload["spot"] == 5220.25
    assert [row["contract_id"] for row in duplicate_payload["rows"]] == ["SPX-C-5220"]

    assert tied_response.status_code == 200
    tied_payload = tied_response.json()
    assert tied_payload["snapshot_time"] == "2026-04-24T15:30:00Z"
    assert tied_payload["spot"] == 5200.25

    assert unknown_source_response.status_code == 200
    unknown_payload = unknown_source_response.json()
    assert unknown_payload["coverage_status"] == "empty"
    assert unknown_payload["rows"] == []


def test_public_replay_websocket_streams_imported_session_in_source_order(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, _import_repository, _replay_repository = public_replay_client

    with client.websocket_connect(
        "/ws/spx/0dte/replay",
        params={"session_id": "import-session-ready", "interval_ms": "50"},
    ) as websocket:
        payloads = [websocket.receive_json() for _ in range(3)]

    assert [payload["snapshot_time"] for payload in payloads] == [
        "2026-04-24T15:30:00Z",
        "2026-04-24T15:40:00Z",
        "2026-04-24T15:40:00Z",
    ]
    assert [payload["spot"] for payload in payloads] == [5200.25, 5210.25, 5220.25]


def test_public_replay_sessions_surface_import_repository_failure(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, import_repository, _replay_repository = public_replay_client
    import_repository.list_completed_sessions_error = RuntimeError("database unavailable")

    response = client.get("/api/spx/0dte/replay/sessions")

    assert response.status_code == 503
    assert response.json()["detail"] == "Imported replay persistence unavailable"


def test_public_replay_timestamps_surface_import_repository_failure(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, import_repository, _replay_repository = public_replay_client
    import_repository.timestamps_error = RuntimeError("database unavailable")

    response = client.get("/api/spx/0dte/replay/sessions/import-session-ready/timestamps")

    assert response.status_code == 503
    assert response.json()["detail"] == "Imported replay persistence unavailable"


def test_public_replay_snapshot_surface_import_repository_failure(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, import_repository, _replay_repository = public_replay_client
    import_repository.snapshot_by_source_id_error = RuntimeError("database unavailable")

    response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "import-session-ready", "source_snapshot_id": "src-before"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Imported replay persistence unavailable"


def test_public_replay_snapshot_surface_import_membership_failure(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, import_repository, _replay_repository = public_replay_client
    import_repository.is_completed_public_session_error = RuntimeError("database unavailable")

    response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "import-session-ready", "source_snapshot_id": "src-before"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Imported replay persistence unavailable"


def test_public_replay_snapshot_surface_import_nearest_failure(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, import_repository, _replay_repository = public_replay_client
    import_repository.nearest_snapshot_error = RuntimeError("database unavailable")

    response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "import-session-ready", "at": "2026-04-24T15:35:00Z"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Imported replay persistence unavailable"


def test_public_replay_snapshot_uses_bounded_import_membership_lookup(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, import_repository, _replay_repository = public_replay_client
    import_repository.list_completed_sessions_error = AssertionError("route should not list all imports for playback")

    response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "import-session-ready", "source_snapshot_id": "src-before"},
    )

    assert response.status_code == 200
    assert response.json()["session_id"] == "import-session-ready"


def test_public_replay_websocket_closes_on_import_repository_failure(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, import_repository, _replay_repository = public_replay_client
    import_repository.stream_snapshots_error = RuntimeError("database unavailable")

    with client.websocket_connect(
        "/ws/spx/0dte/replay",
        params={"session_id": "import-session-ready", "interval_ms": "50"},
    ) as websocket:
        with pytest.raises(WebSocketDisconnect) as disconnect:
            websocket.receive_json()

    assert disconnect.value.code == 1011


def test_public_replay_websocket_sends_empty_snapshot_for_empty_import_selection(
    public_replay_client: tuple[TestClient, "_FakeReplayImportRepository", "_FakeReplayRepository"],
) -> None:
    client, _import_repository, replay_repository = public_replay_client
    replay_repository.replay_snapshots_error = RuntimeError("persisted replay should not be queried")

    with client.websocket_connect(
        "/ws/spx/0dte/replay",
        params={
            "session_id": "import-session-ready",
            "source_snapshot_id": "missing-source",
            "interval_ms": "50",
        },
    ) as websocket:
        payload = websocket.receive_json()

    assert payload["coverage_status"] == "empty"
    assert payload["rows"] == []


class _FakeImporter:
    def __init__(self) -> None:
        self.create_result = _result(status="awaiting_confirmation")
        self.create_results: list[ImportResult] = []
        self.imports: dict[str, ImportResult] = {}
        self.confirm_results: dict[str, ImportResult] = {}
        self.cancel_results: dict[str, ImportResult] = {}
        self.create_calls: list[dict[str, Path]] = []
        self.confirm_calls: list[str] = []

    def create_import(self, *, snapshots_path: Path, quotes_path: Path) -> ImportResult:
        assert snapshots_path.exists()
        assert quotes_path.exists()
        self.create_calls.append(
            {
                "snapshots_path": Path(snapshots_path),
                "quotes_path": Path(quotes_path),
            }
        )
        result = self.create_results.pop(0) if self.create_results else self.create_result
        self.imports[result.import_id] = result
        return result

    def get_import(self, import_id: str) -> ImportResult:
        if import_id not in self.imports:
            raise KeyError(import_id)
        return self.imports[import_id]

    def confirm_import(self, import_id: str) -> ImportResult:
        self.confirm_calls.append(import_id)
        if import_id not in self.confirm_results:
            raise KeyError(import_id)
        return self.confirm_results[import_id]

    def cancel_import(self, import_id: str) -> ImportResult:
        if import_id not in self.cancel_results:
            raise KeyError(import_id)
        return self.cancel_results[import_id]


class _FakeReplayRepository(NullReplayRepository):
    def __init__(self) -> None:
        self.replay_snapshots_error: Exception | None = None

    def list_sessions(self) -> list[dict[str, Any]]:
        return [
            {
                "session_id": "live-session-ready",
                "symbol": "SPX",
                "expiry": "2026-04-24",
                "start_time": "2026-04-24T15:30:00Z",
                "end_time": "2026-04-24T15:30:00Z",
                "snapshot_count": 1,
                "source": "ibkr",
                "timestamp_source": "estimated",
            }
        ]

    def nearest_snapshot(self, session_id: str, at: str | None = None) -> dict[str, Any] | None:
        if session_id != "live-session-ready":
            return None
        return {
            "schema_version": "1.0.0",
            "session_id": "live-session-ready",
            "mode": "replay",
            "symbol": "SPX",
            "expiry": "2026-04-24",
            "snapshot_time": "2026-04-24T15:30:00Z",
            "spot": 5201.25,
            "forward": 5201.25,
            "discount_factor": 1.0,
            "risk_free_rate": 0.0,
            "dividend_yield": 0.0,
            "source_status": "connected",
            "freshness_ms": 0,
            "coverage_status": "empty",
            "scenario_params": None,
            "rows": [],
        }

    def replay_snapshots(self, session_id: str, at: str | None = None) -> list[dict[str, Any]]:
        if self.replay_snapshots_error is not None:
            raise self.replay_snapshots_error
        return []


class _FakeReplayImportRepository:
    def __init__(self) -> None:
        self.snapshots = [
            _imported_snapshot("src-before", 0, "2026-04-24T15:30:00Z", 5200.25, "SPX-C-5200"),
            _imported_snapshot("src-duplicate-earlier", 1, "2026-04-24T15:40:00Z", 5210.25, "SPX-C-5210"),
            _imported_snapshot("src-duplicate-later", 2, "2026-04-24T15:40:00Z", 5220.25, "SPX-C-5220"),
        ]
        self.list_completed_sessions_error: Exception | None = None
        self.is_completed_public_session_error: Exception | None = None
        self.timestamps_error: Exception | None = None
        self.snapshot_by_source_id_error: Exception | None = None
        self.nearest_snapshot_error: Exception | None = None
        self.stream_snapshots_error: Exception | None = None

    def list_completed_sessions(self) -> list[dict[str, Any]]:
        if self.list_completed_sessions_error is not None:
            raise self.list_completed_sessions_error
        return [
            {
                "session_id": "import-session-ready",
                "symbol": "SPX",
                "expiry": "2026-04-24",
                "start_time": "2026-04-24T15:30:00Z",
                "end_time": "2026-04-24T15:40:00Z",
                "snapshot_count": len(self.snapshots),
                "source": "parquet_import",
                "timestamp_source": "exact",
                "import_id": "import-completed",
            }
        ]

    def is_completed_public_session(self, session_id: str) -> bool:
        if self.is_completed_public_session_error is not None:
            raise self.is_completed_public_session_error
        return session_id == "import-session-ready"

    def timestamps(self, session_id: str) -> list[dict[str, Any]]:
        if self.timestamps_error is not None:
            raise self.timestamps_error
        if session_id != "import-session-ready":
            return []
        return [
            {
                "index": snapshot.header.source_order,
                "snapshot_time": snapshot.header.snapshot_time,
                "source_snapshot_id": snapshot.header.source_snapshot_id,
            }
            for snapshot in self.snapshots
        ]

    def snapshot_by_source_id(self, session_id: str, source_snapshot_id: str) -> ImportedSnapshotData | None:
        if self.snapshot_by_source_id_error is not None:
            raise self.snapshot_by_source_id_error
        if session_id != "import-session-ready":
            return None
        return next(
            (
                snapshot
                for snapshot in self.snapshots
                if snapshot.header.source_snapshot_id == source_snapshot_id
            ),
            None,
        )

    def nearest_snapshot(self, session_id: str, at: str | None) -> ImportedSnapshotData | None:
        if self.nearest_snapshot_error is not None:
            raise self.nearest_snapshot_error
        if session_id != "import-session-ready":
            return None
        if at is None:
            return self.snapshots[-1]
        from datetime import datetime

        target = datetime.fromisoformat(at.replace("Z", "+00:00"))
        return min(
            self.snapshots,
            key=lambda snapshot: (
                abs(
                    (
                        datetime.fromisoformat(snapshot.header.snapshot_time.replace("Z", "+00:00")) - target
                    ).total_seconds()
                ),
                snapshot.header.source_order,
            ),
        )

    def stream_snapshots(
        self,
        session_id: str,
        at: str | None,
        source_snapshot_id: str | None,
    ) -> list[ImportedSnapshotData]:
        if self.stream_snapshots_error is not None:
            raise self.stream_snapshots_error
        if session_id != "import-session-ready":
            return []
        if source_snapshot_id is not None:
            snapshot = self.snapshot_by_source_id(session_id, source_snapshot_id)
            return [] if snapshot is None else [snapshot]
        if at is None:
            return self.snapshots
        return [
            snapshot
            for snapshot in self.snapshots
            if snapshot.header.snapshot_time >= at
        ]


def _imported_snapshot(
    source_snapshot_id: str,
    source_order: int,
    snapshot_time: str,
    spot: float,
    contract_id: str,
) -> ImportedSnapshotData:
    return ImportedSnapshotData(
        header=ImportedSnapshotHeader(
            session_id="import-session-ready",
            source_snapshot_id=source_snapshot_id,
            source_order=source_order,
            snapshot_time=snapshot_time,
            expiry="2026-04-24",
            spot=spot,
            pricing_spot=spot,
            forward=spot + 1,
            risk_free_rate=0.04,
            t_minutes=390.0,
            selected_strike_count=1,
            valid_mid_contract_count=1,
            stale_contract_count=0,
            row_count=1,
        ),
        quotes=[
            QuoteRecord(
                session_id="import-session-ready",
                source_snapshot_id=source_snapshot_id,
                source_order=source_order,
                contract_id=contract_id,
                strike=spot,
                right="call",
                bid=10.0,
                ask=10.2,
                mid=10.1,
                ibkr_iv=0.21,
                open_interest=2400,
                quote_valid=True,
                ln_kf=0.0,
                distance_from_atm=0.0,
            )
        ],
    )


def _upload_files(
    tmp_path: Path,
    *,
    snapshots_filename: str = "snapshots.parquet",
    quotes_filename: str = "quotes.parquet",
    include_quotes: bool = True,
) -> list[tuple[str, tuple[str, bytes, str]]]:
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path)
    files = [
        ("snapshots", (snapshots_filename, snapshots_path.read_bytes(), "application/octet-stream")),
    ]
    if include_quotes:
        files.append(("quotes", (quotes_filename, quotes_path.read_bytes(), "application/octet-stream")))
    return files


def _result(
    *,
    import_id: str = "import-route-test",
    status: str,
    summary: dict[str, Any] | None = None,
    warnings: list[str] | None = None,
    errors: list[str] | None = None,
    session_id: str | None = "session-ready",
    replay_url: str | None = None,
) -> ImportResult:
    return ImportResult(
        import_id=import_id,
        status=status,
        summary={"snapshot_count": 3} if summary is None else summary,
        warnings=[] if warnings is None else warnings,
        errors=[] if errors is None else errors,
        session_id=session_id,
        replay_url=replay_url,
    )


def _admin_headers() -> dict[str, str]:
    return {"X-GammaScope-Admin-Token": ADMIN_TOKEN}
