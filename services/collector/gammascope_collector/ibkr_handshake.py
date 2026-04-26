from __future__ import annotations

import argparse
import json
import sys
import threading
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import datetime
from typing import Protocol

from gammascope_collector.events import health_event
from gammascope_collector.ibkr_config import IbkrHealthConfig, ibkr_health_config_from_env
from gammascope_collector.publisher import PublishSummary, publish_events


class IbkrApiUnavailable(RuntimeError):
    pass


class IbkrHandshakeTimeout(TimeoutError):
    pass


class IbkrBrokerError(OSError):
    pass


class IbkrHandshakeAdapter(Protocol):
    def connect(self, host: str, port: int, client_id: int) -> None:
        ...

    def wait_until_ready(self, timeout_seconds: float) -> dict[str, object]:
        ...

    def disconnect(self) -> None:
        ...


AdapterFactory = Callable[[], IbkrHandshakeAdapter]
Importer = Callable[..., object]
Publish = Callable[..., PublishSummary | dict[str, object]]


def run_ibkr_api_handshake(
    config: IbkrHealthConfig,
    *,
    adapter_factory: AdapterFactory | None = None,
) -> dict[str, object]:
    adapter = adapter_factory() if adapter_factory is not None else _create_real_adapter()
    try:
        adapter.connect(config.host, config.port, config.client_id)
        metadata = adapter.wait_until_ready(config.timeout_seconds)
    except BaseException as exc:
        _disconnect_preserving_primary(adapter, exc)
        raise
    else:
        adapter.disconnect()
        return metadata


def ibkr_handshake_health_event(
    config: IbkrHealthConfig,
    *,
    adapter_factory: AdapterFactory | None = None,
    event_time: datetime | None = None,
) -> dict[str, object]:
    endpoint = _endpoint_message(config)
    try:
        metadata = run_ibkr_api_handshake(config, adapter_factory=adapter_factory)
    except IbkrHandshakeTimeout as exc:
        return health_event(
            collector_id=config.collector_id,
            status="stale",
            ibkr_account_mode=config.account_mode,
            message=f"IBKR API handshake timed out for {endpoint}: {exc}",
            event_time=event_time,
            received_time=event_time,
        )
    except IbkrApiUnavailable as exc:
        return health_event(
            collector_id=config.collector_id,
            status="error",
            ibkr_account_mode=config.account_mode,
            message=f"IBKR API handshake unavailable for {endpoint}: missing ibapi package ({exc})",
            event_time=event_time,
            received_time=event_time,
        )
    except OSError as exc:
        return health_event(
            collector_id=config.collector_id,
            status="disconnected",
            ibkr_account_mode=config.account_mode,
            message=f"IBKR API handshake connection failed for {endpoint}: {exc}",
            event_time=event_time,
            received_time=event_time,
        )
    except Exception as exc:
        return health_event(
            collector_id=config.collector_id,
            status="error",
            ibkr_account_mode=config.account_mode,
            message=f"IBKR API handshake failed for {endpoint}: {exc}",
            event_time=event_time,
            received_time=event_time,
        )

    next_order_id = metadata.get("next_order_id")
    suffix = f"; next order id {next_order_id}" if next_order_id is not None else ""
    return health_event(
        collector_id=config.collector_id,
        status="connected",
        ibkr_account_mode=config.account_mode,
        message=f"IBKR API handshake succeeded for {endpoint}{suffix}.",
        event_time=event_time,
        received_time=event_time,
    )


def main(
    argv: Sequence[str] | None = None,
    *,
    adapter_factory: AdapterFactory | None = None,
    publish: Publish | None = None,
) -> None:
    defaults = ibkr_health_config_from_env()
    parser = argparse.ArgumentParser(description="Perform a minimal IBKR API handshake health check.")
    parser.add_argument("--host", default=defaults.host)
    parser.add_argument("--port", type=int, default=defaults.port)
    parser.add_argument("--client-id", type=int, default=defaults.client_id)
    parser.add_argument("--collector-id", default=defaults.collector_id)
    parser.add_argument("--account-mode", choices=["paper", "live", "unknown"], default=defaults.account_mode)
    parser.add_argument("--api", default=defaults.api_base)
    parser.add_argument("--timeout-seconds", type=float, default=defaults.timeout_seconds)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args(_normalize_argv(argv if argv is not None else sys.argv[1:]))

    config = _validated_config(
        defaults,
        host=args.host,
        port=args.port,
        client_id=args.client_id,
        collector_id=args.collector_id,
        account_mode=args.account_mode,
        api_base=args.api,
        timeout_seconds=args.timeout_seconds,
    )
    event = ibkr_handshake_health_event(config, adapter_factory=adapter_factory)

    if args.publish:
        publisher = publish or publish_events
        summary = publisher([event], api_base=config.api_base)
        print(json.dumps(_summary_dict(summary), separators=(",", ":"), sort_keys=True))
        return

    print(json.dumps(event, separators=(",", ":"), sort_keys=True))


class _RealIbkrApiHandshakeAdapter:
    _THREAD_JOIN_TIMEOUT_SECONDS = 1.0
    _CONNECTION_ERROR_CODES = {326, 502, 504, 507, 1100, 1300}

    def __init__(self, client: object, ready_event: threading.Event, metadata: dict[str, object]) -> None:
        self._client = client
        self._ready_event = ready_event
        self._metadata = metadata
        self._thread: threading.Thread | None = None

    def connect(self, host: str, port: int, client_id: int) -> None:
        result = self._client.connect(host, port, client_id)
        if result is False:
            raise OSError(f"IBKR API client refused connection to {host}:{port}")
        self._thread = threading.Thread(target=self._client.run, name="ibkr-api-loop", daemon=True)
        self._thread.start()

    def wait_until_ready(self, timeout_seconds: float) -> dict[str, object]:
        if not self._ready_event.wait(timeout_seconds):
            raise IbkrHandshakeTimeout(self._timeout_message(timeout_seconds))

        terminal_error = _broker_error_message(self._metadata.get("terminal_error"))
        if terminal_error is not None:
            raise IbkrBrokerError(f"IBKR API broker error {terminal_error}")

        server_version = self._call_if_available("serverVersion")
        connection_time = self._call_if_available("twsConnectionTime")
        if server_version is not None:
            self._metadata["server_version"] = server_version
        if connection_time is not None:
            self._metadata["connection_time"] = connection_time
        return dict(self._metadata)

    def disconnect(self) -> None:
        try:
            self._client.disconnect()
        finally:
            self._join_thread()

    def _join_thread(self) -> None:
        if self._thread is not None and self._thread.is_alive() and self._thread is not threading.current_thread():
            self._thread.join(self._THREAD_JOIN_TIMEOUT_SECONDS)

    def _call_if_available(self, name: str) -> object | None:
        value = getattr(self._client, name, None)
        if value is None:
            return None
        try:
            return value()
        except Exception:
            return None

    def _timeout_message(self, timeout_seconds: float) -> str:
        message = f"timed out waiting {timeout_seconds:g}s for nextValidId"
        latest_error = _latest_broker_error(self._metadata)
        if latest_error is not None:
            message = f"{message}; latest IBKR API error {latest_error}"
        return message

    @classmethod
    def is_connection_error_code(cls, code: int) -> bool:
        return code in cls._CONNECTION_ERROR_CODES


def _create_real_adapter(*, importer: Importer = __import__) -> IbkrHandshakeAdapter:
    try:
        client_module = importer("ibapi.client", fromlist=("EClient",))
        wrapper_module = importer("ibapi.wrapper", fromlist=("EWrapper",))
        EClient = getattr(client_module, "EClient")
        EWrapper = getattr(wrapper_module, "EWrapper")
    except ImportError as exc:
        raise IbkrApiUnavailable("Install the official ibapi package to use the IBKR API handshake.") from exc

    ready_event = threading.Event()
    metadata: dict[str, object] = {}

    class HandshakeClient(EWrapper, EClient):  # type: ignore[misc, valid-type]
        def __init__(self) -> None:
            EWrapper.__init__(self)
            EClient.__init__(self, wrapper=self)

        def nextValidId(self, orderId: int) -> None:
            metadata["next_order_id"] = orderId
            ready_event.set()

        def managedAccounts(self, accountsList: str) -> None:
            metadata["managed_accounts"] = [account for account in accountsList.split(",") if account]

        def error(self, *args: object) -> None:
            error = _parse_ibkr_error_args(args)
            if error is None:
                return
            errors = metadata.setdefault("errors", [])
            if isinstance(errors, list):
                errors.append(error)
            if _RealIbkrApiHandshakeAdapter.is_connection_error_code(int(error["code"])):
                metadata["terminal_error"] = error
                ready_event.set()

        def connectionClosed(self) -> None:
            error = {
                "id": -1,
                "error_time": None,
                "code": 507,
                "message": "connection closed",
                "advanced": "",
            }
            errors = metadata.setdefault("errors", [])
            if isinstance(errors, list):
                errors.append(error)
            metadata.setdefault("terminal_error", error)
            ready_event.set()

        def connectClosed(self) -> None:
            self.connectionClosed()

    return _RealIbkrApiHandshakeAdapter(HandshakeClient(), ready_event, metadata)


def _disconnect_preserving_primary(adapter: IbkrHandshakeAdapter, primary: BaseException) -> None:
    try:
        adapter.disconnect()
    except Exception as exc:
        primary.add_note(f"IBKR API disconnect also failed: {exc}")


def _latest_broker_error(metadata: dict[str, object]) -> str | None:
    errors = metadata.get("errors")
    if not isinstance(errors, list) or not errors:
        return None

    return _broker_error_message(errors[-1])


def _parse_ibkr_error_args(args: tuple[object, ...]) -> dict[str, object] | None:
    if len(args) == 3:
        req_id, error_code, error_string = args
        advanced_order_reject_json = ""
        error_time = None
    elif len(args) == 4:
        req_id, error_code, error_string, advanced_order_reject_json = args
        error_time = None
    elif len(args) == 5:
        req_id, error_time, error_code, error_string, advanced_order_reject_json = args
    else:
        return None

    try:
        code = int(error_code)
    except (TypeError, ValueError):
        return None

    return {
        "id": req_id,
        "error_time": error_time,
        "code": code,
        "message": str(error_string),
        "advanced": str(advanced_order_reject_json or ""),
    }


def _broker_error_message(error: object) -> str | None:
    if error is None:
        return None
    if not isinstance(error, dict):
        return str(error)

    code = error.get("code")
    message = error.get("message")
    req_id = error.get("id")
    advanced = error.get("advanced")
    parts = []
    if req_id is not None:
        parts.append(f"id {req_id}")
    if code is not None:
        parts.append(f"code {code}")
    if message:
        parts.append(str(message))
    if advanced:
        parts.append(str(advanced))
    return ": ".join(parts) if parts else str(error)


def _endpoint_message(config: IbkrHealthConfig) -> str:
    return f"{config.host}:{config.port} with client id {config.client_id}"


def _validated_config(config: IbkrHealthConfig, **overrides: object) -> IbkrHealthConfig:
    candidate = replace(config, **overrides)
    return ibkr_health_config_from_env(
        {
            "GAMMASCOPE_IBKR_HOST": candidate.host,
            "GAMMASCOPE_IBKR_PORT": str(candidate.port),
            "GAMMASCOPE_IBKR_CLIENT_ID": str(candidate.client_id),
            "GAMMASCOPE_COLLECTOR_ID": candidate.collector_id,
            "GAMMASCOPE_IBKR_ACCOUNT_MODE": candidate.account_mode,
            "GAMMASCOPE_API_BASE_URL": candidate.api_base,
            "GAMMASCOPE_IBKR_TIMEOUT_SECONDS": str(candidate.timeout_seconds),
        }
    )


def _summary_dict(summary: PublishSummary | dict[str, object]) -> dict[str, object]:
    if isinstance(summary, dict):
        return summary
    return summary.as_dict()


def _normalize_argv(argv: Sequence[str] | None) -> Sequence[str] | None:
    if argv and argv[0] == "--":
        return argv[1:]
    return argv


if __name__ == "__main__":
    main()
