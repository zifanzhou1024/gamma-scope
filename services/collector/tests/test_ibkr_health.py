from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
import json

import pytest

from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_collector.ibkr_config import IbkrHealthConfig
from gammascope_collector.ibkr_health import main, probe_ibkr_health
from gammascope_collector.publisher import PublishSummary


EVENT_TIME = datetime(2026, 4, 24, 14, 45, tzinfo=UTC)


@dataclass
class FakeConnection:
    entered: bool = False
    exited: bool = False

    def __enter__(self) -> FakeConnection:
        self.entered = True
        return self

    def __exit__(self, *_exc_info: object) -> None:
        self.exited = True


def test_probe_ibkr_health_success_emits_contract_valid_connected_event_and_closes_connection() -> None:
    config = IbkrHealthConfig(
        host="127.0.0.1",
        port=4002,
        client_id=13,
        collector_id="local-test",
        account_mode="paper",
        api_base="http://testserver",
        timeout_seconds=0.5,
    )
    connection = FakeConnection()
    calls: list[tuple[tuple[str, int], float]] = []

    def connect(address: tuple[str, int], *, timeout: float) -> FakeConnection:
        calls.append((address, timeout))
        return connection

    event = probe_ibkr_health(config, connect=connect, event_time=EVENT_TIME)

    CollectorEvents.model_validate(event)
    assert calls == [(("127.0.0.1", 4002), 0.5)]
    assert connection.entered is True
    assert connection.exited is True
    assert event["collector_id"] == "local-test"
    assert event["ibkr_account_mode"] == "paper"
    assert event["status"] == "connected"
    assert event["event_time"] == "2026-04-24T14:45:00Z"
    assert event["received_time"] == "2026-04-24T14:45:00Z"
    assert "127.0.0.1:4002" in str(event["message"])
    assert "TCP probe only" in str(event["message"])


def test_probe_ibkr_health_failure_emits_contract_valid_disconnected_event() -> None:
    config = IbkrHealthConfig(
        host="localhost",
        port=7497,
        client_id=7,
        collector_id="local-ibkr",
        account_mode="unknown",
        api_base="http://testserver",
        timeout_seconds=2.0,
    )

    def connect(_address: tuple[str, int], *, timeout: float) -> FakeConnection:
        raise TimeoutError("timed out")

    event = probe_ibkr_health(config, connect=connect, event_time=EVENT_TIME)

    CollectorEvents.model_validate(event)
    assert event["status"] == "disconnected"
    assert event["collector_id"] == "local-ibkr"
    assert event["ibkr_account_mode"] == "unknown"
    assert event["event_time"] == "2026-04-24T14:45:00Z"
    assert "localhost:7497" in str(event["message"])
    assert "timed out" in str(event["message"])


def test_probe_ibkr_health_failure_handles_oserror_reason() -> None:
    config = IbkrHealthConfig(
        host="localhost",
        port=7497,
        client_id=7,
        collector_id="local-ibkr",
        account_mode="paper",
        api_base="http://testserver",
        timeout_seconds=2.0,
    )

    def connect(_address: tuple[str, int], *, timeout: float) -> FakeConnection:
        raise OSError("connection refused")

    event = probe_ibkr_health(config, connect=connect, event_time=EVENT_TIME)

    assert event["status"] == "disconnected"
    assert "connection refused" in str(event["message"])


def test_cli_prints_single_event_json_without_publish_and_accepts_pnpm_separator(capsys) -> None:
    def connect(_address: tuple[str, int], *, timeout: float) -> FakeConnection:
        return FakeConnection()

    main(["--", "--host", "localhost", "--port", "4002", "--collector-id", "cli-probe"], connect=connect)

    event = json.loads(capsys.readouterr().out)
    CollectorEvents.model_validate(event)
    assert event["collector_id"] == "cli-probe"
    assert event["status"] == "connected"
    assert "localhost:4002" in event["message"]


def test_cli_publish_mode_uses_injected_publisher_and_prints_summary(capsys) -> None:
    captured_events: list[dict[str, object]] = []
    captured_api_bases: list[str] = []

    def connect(_address: tuple[str, int], *, timeout: float) -> FakeConnection:
        return FakeConnection()

    def publish(events: Iterable[dict[str, object]], *, api_base: str) -> PublishSummary:
        captured_events.extend(events)
        captured_api_bases.append(api_base)
        return PublishSummary(
            endpoint=f"{api_base}/api/spx/0dte/collector/events",
            accepted_count=len(captured_events),
            event_types=["CollectorHealth"],
        )

    main(
        ["--publish", "--api", "http://testserver", "--account-mode", "live"],
        connect=connect,
        publish=publish,
    )

    summary = json.loads(capsys.readouterr().out)
    assert len(captured_events) == 1
    assert captured_events[0]["status"] == "connected"
    assert captured_events[0]["ibkr_account_mode"] == "live"
    assert captured_api_bases == ["http://testserver"]
    assert summary == {
        "accepted_count": 1,
        "endpoint": "http://testserver/api/spx/0dte/collector/events",
        "event_types": ["CollectorHealth"],
    }


def test_cli_publish_mode_accepts_injected_publisher_returning_dict(capsys) -> None:
    def connect(_address: tuple[str, int], *, timeout: float) -> FakeConnection:
        return FakeConnection()

    def publish(events: Iterable[dict[str, object]], *, api_base: str) -> dict[str, object]:
        assert len(list(events)) == 1
        assert api_base == "http://testserver"
        return {"accepted_count": 1, "endpoint": "http://testserver/custom", "event_types": ["CollectorHealth"]}

    main(["--publish", "--api", "http://testserver"], connect=connect, publish=publish)

    assert json.loads(capsys.readouterr().out)["accepted_count"] == 1


@pytest.mark.parametrize("value", ["nan", "inf"])
def test_cli_rejects_non_finite_timeout_seconds(value: str) -> None:
    with pytest.raises(ValueError, match="timeout_seconds"):
        main(["--timeout-seconds", value], connect=lambda *_args, **_kwargs: FakeConnection())


def test_cli_rejects_empty_api_base() -> None:
    with pytest.raises(ValueError, match="api_base"):
        main(["--api", "   "], connect=lambda *_args, **_kwargs: FakeConnection())
