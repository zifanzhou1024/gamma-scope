from datetime import UTC, datetime
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

import gammascope_collector.publisher as publisher
from gammascope_collector.events import health_event, underlying_tick_event
from gammascope_collector.publisher import (
    PublishError,
    collector_event_endpoint,
    collector_events_bulk_endpoint,
    main,
    publish_events,
    publish_events_bulk,
)


EVENT_TIME = datetime(2026, 4, 23, 15, 30, tzinfo=UTC)


def test_collector_event_endpoint_joins_api_base() -> None:
    assert collector_event_endpoint("http://127.0.0.1:8000") == (
        "http://127.0.0.1:8000/api/spx/0dte/collector/events"
    )
    assert collector_event_endpoint("http://127.0.0.1:8000/") == (
        "http://127.0.0.1:8000/api/spx/0dte/collector/events"
    )


def test_collector_events_bulk_endpoint_joins_api_base() -> None:
    assert collector_events_bulk_endpoint("http://127.0.0.1:8000") == (
        "http://127.0.0.1:8000/api/spx/0dte/collector/events/bulk"
    )
    assert collector_events_bulk_endpoint("http://127.0.0.1:8000/") == (
        "http://127.0.0.1:8000/api/spx/0dte/collector/events/bulk"
    )


def test_publish_events_uses_admin_token_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "server-admin-token")
    event = health_event(
        collector_id="local-dev",
        status="connected",
        ibkr_account_mode="paper",
        message="ok",
        event_time=EVENT_TIME,
        received_time=EVENT_TIME,
    )
    captured_tokens: list[str | None] = []

    def fake_post_json(
        _endpoint: str,
        _event: dict[str, object],
        *,
        admin_token: str | None = None,
    ) -> dict[str, object]:
        captured_tokens.append(admin_token)
        return {"accepted": True, "event_type": "CollectorHealth"}

    monkeypatch.setattr(publisher, "_post_json", fake_post_json)

    publish_events([event], api_base="http://testserver")

    assert captured_tokens == ["server-admin-token"]


def test_post_json_adds_admin_token_header(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_requests: list[publisher.Request] = []

    class FakeResponse:
        def __enter__(self) -> object:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def read(self) -> bytes:
            return b'{"accepted": true, "event_type": "CollectorHealth"}'

    def fake_urlopen(request: publisher.Request, timeout: float) -> FakeResponse:
        captured_requests.append(request)
        assert timeout == 5
        return FakeResponse()

    monkeypatch.setattr(publisher, "urlopen", fake_urlopen)

    publisher._post_json("http://testserver/collector", {"ok": True}, admin_token="server-admin-token")

    assert captured_requests[0].get_header("X-gammascope-admin-token") == "server-admin-token"


def test_post_json_uses_macos_system_ca_when_python_ca_path_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    cert_file = tmp_path / "cert.pem"
    cert_file.write_text("test cert", encoding="utf-8")
    expected_context = object()
    captured_contexts: list[object | None] = []

    class FakeResponse:
        def __enter__(self) -> object:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def read(self) -> bytes:
            return b'{"accepted": true, "event_type": "CollectorHealth"}'

    def fake_urlopen(request: publisher.Request, *, timeout: float, context: object | None = None) -> FakeResponse:
        captured_contexts.append(context)
        assert request.full_url == "https://testserver/collector"
        assert timeout == 5
        return FakeResponse()

    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.setattr(publisher, "MACOS_SYSTEM_CERT_FILE", cert_file)
    monkeypatch.setattr(
        publisher.ssl,
        "get_default_verify_paths",
        lambda: SimpleNamespace(cafile="/missing/python/cert.pem"),
    )
    monkeypatch.setattr(
        publisher.ssl,
        "create_default_context",
        lambda *, cafile: expected_context,
    )
    monkeypatch.setattr(publisher, "urlopen", fake_urlopen)

    publisher._post_json("https://testserver/collector", {"ok": True}, admin_token="server-admin-token")

    assert captured_contexts == [expected_context]


def test_publish_events_posts_each_event_to_ingestion_endpoint() -> None:
    events = [
        health_event(
            collector_id="local-dev",
            status="connected",
            ibkr_account_mode="paper",
            message="ok",
            event_time=EVENT_TIME,
            received_time=EVENT_TIME,
        ),
        underlying_tick_event(
            session_id="live-spx-local-mock",
            bid=5199.75,
            ask=5200.75,
            last=5200.25,
            event_time=EVENT_TIME,
        ),
    ]
    posts: list[tuple[str, dict[str, object]]] = []

    def fake_post(endpoint: str, event: dict[str, object]) -> dict[str, object]:
        posts.append((endpoint, event))
        event_type = "CollectorHealth" if "collector_id" in event else "UnderlyingTick"
        return {"accepted": True, "event_type": event_type}

    summary = publish_events(events, api_base="http://testserver", post_json=fake_post)

    assert [endpoint for endpoint, _ in posts] == [
        "http://testserver/api/spx/0dte/collector/events",
        "http://testserver/api/spx/0dte/collector/events",
    ]
    assert [event for _, event in posts] == events
    assert summary.accepted_count == 2
    assert summary.event_types == ["CollectorHealth", "UnderlyingTick"]


def test_publish_events_bulk_posts_one_batch_to_bulk_ingestion_endpoint() -> None:
    events = [
        health_event(
            collector_id="local-dev",
            status="connected",
            ibkr_account_mode="paper",
            message="ok",
            event_time=EVENT_TIME,
            received_time=EVENT_TIME,
        ),
        underlying_tick_event(
            session_id="live-spx-local-mock",
            bid=5199.75,
            ask=5200.75,
            last=5200.25,
            event_time=EVENT_TIME,
        ),
    ]
    posts: list[tuple[str, list[dict[str, object]]]] = []

    def fake_post(endpoint: str, batch: list[dict[str, object]]) -> dict[str, object]:
        posts.append((endpoint, batch))
        return {"accepted": True, "accepted_count": 2, "event_types": ["CollectorHealth", "UnderlyingTick"]}

    summary = publish_events_bulk(events, api_base="http://testserver", post_json=fake_post)

    assert posts == [("http://testserver/api/spx/0dte/collector/events/bulk", events)]
    assert summary.accepted_count == 2
    assert summary.event_types == ["CollectorHealth", "UnderlyingTick"]


def test_publish_events_raises_when_backend_rejects_event() -> None:
    event = health_event(
        collector_id="local-dev",
        status="error",
        ibkr_account_mode="paper",
        message="not accepted",
        event_time=EVENT_TIME,
        received_time=EVENT_TIME,
    )

    def fake_post(_endpoint: str, _event: dict[str, object]) -> dict[str, object]:
        return {"accepted": False, "event_type": "CollectorHealth"}

    with pytest.raises(PublishError, match="rejected"):
        publish_events([event], api_base="http://testserver", post_json=fake_post)


def test_publish_mock_cli_prints_summary(capsys) -> None:
    def fake_post(_endpoint: str, event: dict[str, object]) -> dict[str, object]:
        if "collector_id" in event:
            event_type = "CollectorHealth"
        elif "ibkr_con_id" in event:
            event_type = "ContractDiscovered"
        elif "spot" in event:
            event_type = "UnderlyingTick"
        else:
            event_type = "OptionTick"
        return {"accepted": True, "event_type": event_type}

    main(
        ["--api", "http://testserver", "--spot", "5200.25", "--expiry", "2026-04-23", "--strikes", "5200"],
        post_json=fake_post,
    )

    summary = json.loads(capsys.readouterr().out)
    assert summary["endpoint"] == "http://testserver/api/spx/0dte/collector/events"
    assert summary["accepted_count"] == 6
    assert summary["event_types"] == [
        "CollectorHealth",
        "UnderlyingTick",
        "ContractDiscovered",
        "ContractDiscovered",
        "OptionTick",
        "OptionTick",
    ]


def test_publish_mock_cli_accepts_pnpm_forwarded_separator(capsys) -> None:
    def fake_post(_endpoint: str, _event: dict[str, object]) -> dict[str, object]:
        return {"accepted": True, "event_type": "ok"}

    main(
        ["--", "--api", "http://testserver", "--spot", "5200.25", "--expiry", "2026-04-23", "--strikes", "5200"],
        post_json=fake_post,
    )

    summary = json.loads(capsys.readouterr().out)
    assert summary["accepted_count"] == 6
