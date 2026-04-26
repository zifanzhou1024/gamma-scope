from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
import json
from types import SimpleNamespace
import threading
import time

import pytest

import gammascope_collector.ibkr_handshake as ibkr_handshake
from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_collector.ibkr_config import IbkrHealthConfig
from gammascope_collector.ibkr_handshake import (
    IbkrApiUnavailable,
    IbkrHandshakeTimeout,
    _RealIbkrApiHandshakeAdapter,
    _create_real_adapter,
    ibkr_handshake_health_event,
    main,
    run_ibkr_api_handshake,
)
from gammascope_collector.publisher import PublishSummary


EVENT_TIME = datetime(2026, 4, 25, 15, 30, tzinfo=UTC)


class FakeEWrapper:
    pass


class FakeEClient:
    def __init__(self, wrapper: object) -> None:
        self.wrapper = wrapper
        self.stop_requested = threading.Event()

    def connect(self, _host: str, _port: int, _client_id: int) -> bool:
        return True

    def run(self) -> None:
        self.stop_requested.wait(1)

    def disconnect(self) -> None:
        self.stop_requested.set()


def fake_ibapi_importer(name: str, *_args: object, **_kwargs: object) -> object:
    if name == "ibapi.client":
        return SimpleNamespace(EClient=FakeEClient)
    if name == "ibapi.wrapper":
        return SimpleNamespace(EWrapper=FakeEWrapper)
    return __import__(name)


@dataclass
class FakeHandshakeAdapter:
    metadata: dict[str, object] | None = None
    wait_error: Exception | None = None
    connect_error: Exception | None = None
    disconnect_error: Exception | None = None
    disconnected: bool = False
    connect_calls: list[tuple[str, int, int]] | None = None
    wait_calls: list[float] | None = None

    def connect(self, host: str, port: int, client_id: int) -> None:
        self.connect_calls = self.connect_calls or []
        self.connect_calls.append((host, port, client_id))
        if self.connect_error is not None:
            raise self.connect_error

    def wait_until_ready(self, timeout_seconds: float) -> dict[str, object]:
        self.wait_calls = self.wait_calls or []
        self.wait_calls.append(timeout_seconds)
        if self.wait_error is not None:
            raise self.wait_error
        return dict(self.metadata or {})

    def disconnect(self) -> None:
        self.disconnected = True
        if self.disconnect_error is not None:
            raise self.disconnect_error


def config() -> IbkrHealthConfig:
    return IbkrHealthConfig(
        host="127.0.0.1",
        port=4002,
        client_id=13,
        collector_id="local-test",
        account_mode="paper",
        api_base="http://testserver",
        timeout_seconds=0.5,
    )


def test_run_ibkr_api_handshake_fake_adapter_success_preserves_metadata_and_disconnects() -> None:
    adapter = FakeHandshakeAdapter(
        metadata={
            "next_order_id": 1201,
            "server_version": 178,
            "connection_time": "20260425 15:30:00 UTC",
            "managed_accounts": ["DU12345"],
        }
    )

    metadata = run_ibkr_api_handshake(config(), adapter_factory=lambda: adapter)

    assert metadata == {
        "next_order_id": 1201,
        "server_version": 178,
        "connection_time": "20260425 15:30:00 UTC",
        "managed_accounts": ["DU12345"],
    }
    assert adapter.connect_calls == [("127.0.0.1", 4002, 13)]
    assert adapter.wait_calls == [0.5]
    assert adapter.disconnected is True


def test_run_ibkr_api_handshake_fake_adapter_timeout_raises_and_disconnects() -> None:
    adapter = FakeHandshakeAdapter(wait_error=IbkrHandshakeTimeout("timed out"))

    with pytest.raises(IbkrHandshakeTimeout, match="timed out"):
        run_ibkr_api_handshake(config(), adapter_factory=lambda: adapter)

    assert adapter.disconnected is True


def test_run_ibkr_api_handshake_fake_adapter_connection_error_disconnects() -> None:
    adapter = FakeHandshakeAdapter(connect_error=OSError("connection refused"))

    with pytest.raises(OSError, match="connection refused"):
        run_ibkr_api_handshake(config(), adapter_factory=lambda: adapter)

    assert adapter.disconnected is True


def test_run_ibkr_api_handshake_preserves_timeout_when_disconnect_fails() -> None:
    adapter = FakeHandshakeAdapter(
        wait_error=IbkrHandshakeTimeout("timed out"),
        disconnect_error=RuntimeError("disconnect failed"),
    )

    with pytest.raises(IbkrHandshakeTimeout, match="timed out"):
        run_ibkr_api_handshake(config(), adapter_factory=lambda: adapter)

    assert adapter.disconnected is True


def test_create_real_adapter_raises_unavailable_when_importer_cannot_load_ibapi() -> None:
    def importer(name: str, *_args: object, **_kwargs: object) -> object:
        if name.startswith("ibapi"):
            raise ImportError("no module named ibapi")
        return __import__(name)

    with pytest.raises(IbkrApiUnavailable, match="ibapi"):
        _create_real_adapter(importer=importer)


def test_run_ibkr_api_handshake_without_ibapi_raises_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_unavailable() -> object:
        raise IbkrApiUnavailable("ibapi is missing")

    monkeypatch.setattr(ibkr_handshake, "_create_real_adapter", raise_unavailable)

    with pytest.raises(IbkrApiUnavailable, match="ibapi"):
        run_ibkr_api_handshake(config())


def test_real_adapter_disconnect_joins_network_thread() -> None:
    class BlockingClient:
        def __init__(self) -> None:
            self.stop_requested = threading.Event()
            self.run_entered = threading.Event()
            self.run_exited = threading.Event()
            self.disconnected = False

        def connect(self, _host: str, _port: int, _client_id: int) -> bool:
            return True

        def run(self) -> None:
            self.run_entered.set()
            self.stop_requested.wait(1)
            time.sleep(0.03)
            self.run_exited.set()

        def disconnect(self) -> None:
            self.disconnected = True
            self.stop_requested.set()

    client = BlockingClient()
    adapter = _RealIbkrApiHandshakeAdapter(client, threading.Event(), {})

    adapter.connect("127.0.0.1", 4002, 13)
    assert client.run_entered.wait(0.5) is True

    adapter.disconnect()

    assert client.disconnected is True
    assert client.run_exited.is_set() is True


def test_real_adapter_timeout_includes_latest_broker_error_context() -> None:
    class IdleClient:
        def serverVersion(self) -> int:
            return 178

        def twsConnectionTime(self) -> str:
            return "20260425 15:30:00 UTC"

    adapter = _RealIbkrApiHandshakeAdapter(
        IdleClient(),
        threading.Event(),
        {"errors": [{"id": -1, "code": 502, "message": "Could not connect to TWS"}]},
    )

    with pytest.raises(IbkrHandshakeTimeout, match="502.*Could not connect to TWS"):
        adapter.wait_until_ready(0.01)


@pytest.mark.parametrize(
    ("callback_args", "expected_error_time", "expected_code", "expected_message"),
    [
        ((-1, 502, "Could not connect to TWS"), None, "502", "Could not connect to TWS"),
        (
            (-1, "20260425 15:30:00 UTC", 502, "Could not connect to TWS", ""),
            "20260425 15:30:00 UTC",
            "502",
            "Could not connect to TWS",
        ),
        ((-1, 326, "Client ID is already in use"), None, "326", "Client ID is already in use"),
        ((-1, 507, "Bad Message Length"), None, "507", "Bad Message Length"),
    ],
)
def test_real_adapter_broker_connection_error_callback_fails_wait_promptly(
    callback_args: tuple[object, ...],
    expected_error_time: str | None,
    expected_code: str,
    expected_message: str,
) -> None:
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)

    start = time.monotonic()
    adapter._client.error(*callback_args)

    with pytest.raises(OSError, match=f"{expected_code}.*{expected_message}"):
        adapter.wait_until_ready(0.5)

    assert time.monotonic() - start < 0.2
    assert adapter._metadata["terminal_error"]["error_time"] == expected_error_time
    adapter.disconnect()


@pytest.mark.parametrize(
    ("callback_args", "expected_code", "expected_message"),
    [
        ((-1, 502, "Could not connect to TWS"), "502", "Could not connect to TWS"),
        (
            (-1, "20260425 15:30:00 UTC", 502, "Could not connect to TWS", ""),
            "502",
            "Could not connect to TWS",
        ),
        ((-1, 326, "Client ID is already in use"), "326", "Client ID is already in use"),
        ((-1, 507, "Bad Message Length"), "507", "Bad Message Length"),
    ],
)
def test_real_adapter_broker_error_health_event_is_disconnected(
    callback_args: tuple[object, ...],
    expected_code: str,
    expected_message: str,
) -> None:
    adapter = _create_real_adapter(importer=fake_ibapi_importer)

    def adapter_factory() -> object:
        def fail_with_broker_error() -> None:
            adapter._client.error(*callback_args)

        adapter._client.run = fail_with_broker_error
        return adapter

    event = ibkr_handshake_health_event(
        config(),
        adapter_factory=adapter_factory,
        event_time=EVENT_TIME,
    )

    CollectorEvents.model_validate(event)
    assert event["status"] == "disconnected"
    assert expected_code in str(event["message"])
    assert expected_message in str(event["message"])


def test_real_adapter_connection_closed_callback_fails_wait_promptly() -> None:
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)

    start = time.monotonic()
    adapter._client.connectionClosed()

    with pytest.raises(OSError, match="connection closed"):
        adapter.wait_until_ready(0.5)

    assert time.monotonic() - start < 0.2
    adapter.disconnect()


def test_real_adapter_connection_closed_preserves_prior_terminal_broker_error() -> None:
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)

    adapter._client.error(-1, 502, "Could not connect to TWS")
    adapter._client.connectionClosed()

    with pytest.raises(OSError, match="502.*Could not connect to TWS"):
        adapter.wait_until_ready(0.5)

    assert adapter._metadata["terminal_error"]["code"] == 502
    assert adapter._metadata["terminal_error"]["message"] == "Could not connect to TWS"
    adapter.disconnect()


def test_real_adapter_disconnect_joins_thread_when_client_disconnect_raises() -> None:
    class RaisingDisconnectClient:
        def __init__(self) -> None:
            self.stop_requested = threading.Event()
            self.run_entered = threading.Event()
            self.run_exited = threading.Event()

        def connect(self, _host: str, _port: int, _client_id: int) -> bool:
            return True

        def run(self) -> None:
            self.run_entered.set()
            self.stop_requested.wait(1)
            self.run_exited.set()

        def disconnect(self) -> None:
            self.stop_requested.set()
            raise RuntimeError("disconnect failed")

    client = RaisingDisconnectClient()
    adapter = _RealIbkrApiHandshakeAdapter(client, threading.Event(), {})

    adapter.connect("127.0.0.1", 4002, 13)
    assert client.run_entered.wait(0.5) is True

    with pytest.raises(RuntimeError, match="disconnect failed"):
        adapter.disconnect()

    assert client.run_exited.is_set() is True


def test_ibkr_handshake_health_event_success_is_contract_valid_connected_event() -> None:
    adapter = FakeHandshakeAdapter(metadata={"next_order_id": 1201})

    event = ibkr_handshake_health_event(
        config(),
        adapter_factory=lambda: adapter,
        event_time=EVENT_TIME,
    )

    CollectorEvents.model_validate(event)
    assert event["collector_id"] == "local-test"
    assert event["ibkr_account_mode"] == "paper"
    assert event["status"] == "connected"
    assert event["event_time"] == "2026-04-25T15:30:00Z"
    assert event["received_time"] == "2026-04-25T15:30:00Z"
    assert "IBKR API handshake succeeded" in str(event["message"])
    assert "127.0.0.1:4002" in str(event["message"])
    assert "client id 13" in str(event["message"])
    assert "next order id 1201" in str(event["message"])


def test_ibkr_handshake_health_event_timeout_is_contract_valid_stale_event() -> None:
    adapter = FakeHandshakeAdapter(wait_error=IbkrHandshakeTimeout("timed out waiting for nextValidId"))

    event = ibkr_handshake_health_event(
        config(),
        adapter_factory=lambda: adapter,
        event_time=EVENT_TIME,
    )

    CollectorEvents.model_validate(event)
    assert event["status"] == "stale"
    assert "timed out" in str(event["message"])
    assert "127.0.0.1:4002" in str(event["message"])
    assert "client id 13" in str(event["message"])


def test_ibkr_handshake_health_event_connection_error_is_disconnected_event() -> None:
    adapter = FakeHandshakeAdapter(connect_error=OSError("connection refused"))

    event = ibkr_handshake_health_event(
        config(),
        adapter_factory=lambda: adapter,
        event_time=EVENT_TIME,
    )

    CollectorEvents.model_validate(event)
    assert event["status"] == "disconnected"
    assert "connection refused" in str(event["message"])
    assert "127.0.0.1:4002" in str(event["message"])
    assert "client id 13" in str(event["message"])


def test_ibkr_handshake_health_event_unexpected_exception_is_error_event() -> None:
    adapter = FakeHandshakeAdapter(wait_error=RuntimeError("callback failed"))

    event = ibkr_handshake_health_event(
        config(),
        adapter_factory=lambda: adapter,
        event_time=EVENT_TIME,
    )

    CollectorEvents.model_validate(event)
    assert event["status"] == "error"
    assert "callback failed" in str(event["message"])


def test_ibkr_handshake_health_event_missing_ibapi_is_error_event(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_unavailable() -> object:
        raise IbkrApiUnavailable("ibapi is missing")

    monkeypatch.setattr(ibkr_handshake, "_create_real_adapter", raise_unavailable)

    event = ibkr_handshake_health_event(config(), event_time=EVENT_TIME)

    CollectorEvents.model_validate(event)
    assert event["status"] == "error"
    assert "ibapi" in str(event["message"])


def test_ibkr_handshake_health_event_timeout_not_masked_by_disconnect_failure() -> None:
    adapter = FakeHandshakeAdapter(
        wait_error=IbkrHandshakeTimeout("timed out waiting for nextValidId"),
        disconnect_error=RuntimeError("disconnect failed"),
    )

    event = ibkr_handshake_health_event(
        config(),
        adapter_factory=lambda: adapter,
        event_time=EVENT_TIME,
    )

    CollectorEvents.model_validate(event)
    assert event["status"] == "stale"
    assert "timed out waiting for nextValidId" in str(event["message"])
    assert "disconnect failed" not in str(event["message"])


def test_cli_prints_single_event_json_without_publish_and_accepts_pnpm_separator(capsys) -> None:
    adapter = FakeHandshakeAdapter(metadata={"next_order_id": 1201})

    main(
        ["--", "--host", "localhost", "--port", "4002", "--collector-id", "cli-probe"],
        adapter_factory=lambda: adapter,
    )

    event = json.loads(capsys.readouterr().out)
    CollectorEvents.model_validate(event)
    assert event["collector_id"] == "cli-probe"
    assert event["status"] == "connected"
    assert "localhost:4002" in event["message"]
    assert "next order id 1201" in event["message"]


def test_cli_publish_mode_uses_injected_publisher_and_prints_summary(capsys) -> None:
    captured_events: list[dict[str, object]] = []
    captured_api_bases: list[str] = []

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
        adapter_factory=lambda: FakeHandshakeAdapter(metadata={"next_order_id": 1201}),
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
