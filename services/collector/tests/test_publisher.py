from datetime import UTC, datetime
import json

import pytest

from gammascope_collector.events import health_event, underlying_tick_event
from gammascope_collector.publisher import PublishError, collector_event_endpoint, main, publish_events


EVENT_TIME = datetime(2026, 4, 23, 15, 30, tzinfo=UTC)


def test_collector_event_endpoint_joins_api_base() -> None:
    assert collector_event_endpoint("http://127.0.0.1:8000") == (
        "http://127.0.0.1:8000/api/spx/0dte/collector/events"
    )
    assert collector_event_endpoint("http://127.0.0.1:8000/") == (
        "http://127.0.0.1:8000/api/spx/0dte/collector/events"
    )


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
