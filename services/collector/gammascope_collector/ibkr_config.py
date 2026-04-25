from __future__ import annotations

import math
import os
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class IbkrHealthConfig:
    host: str = "127.0.0.1"
    port: int = 7497
    client_id: int = 7
    collector_id: str = "local-ibkr"
    account_mode: str = "paper"
    api_base: str = "http://127.0.0.1:8000"
    timeout_seconds: float = 2.0


def ibkr_health_config_from_env(environ: Mapping[str, str] | None = None) -> IbkrHealthConfig:
    env = os.environ if environ is None else environ
    config = IbkrHealthConfig(
        host=_str_value(env, "GAMMASCOPE_IBKR_HOST", IbkrHealthConfig.host),
        port=_int_value(env, "GAMMASCOPE_IBKR_PORT", IbkrHealthConfig.port),
        client_id=_int_value(env, "GAMMASCOPE_IBKR_CLIENT_ID", IbkrHealthConfig.client_id),
        collector_id=_str_value(env, "GAMMASCOPE_COLLECTOR_ID", IbkrHealthConfig.collector_id),
        account_mode=_str_value(env, "GAMMASCOPE_IBKR_ACCOUNT_MODE", IbkrHealthConfig.account_mode),
        api_base=_str_value(env, "GAMMASCOPE_API_BASE_URL", IbkrHealthConfig.api_base),
        timeout_seconds=_float_value(
            env,
            "GAMMASCOPE_IBKR_TIMEOUT_SECONDS",
            IbkrHealthConfig.timeout_seconds,
        ),
    )
    _validate(config)
    return config


def _str_value(env: Mapping[str, str], name: str, default: str) -> str:
    return env.get(name, default).strip()


def _int_value(env: Mapping[str, str], name: str, default: int) -> int:
    value = env.get(name)
    if value is None:
        return default
    try:
        return int(value.strip())
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def _float_value(env: Mapping[str, str], name: str, default: float) -> float:
    value = env.get(name)
    if value is None:
        return default
    try:
        return float(value.strip())
    except ValueError as exc:
        raise ValueError(f"{name} must be a float") from exc


def _validate(config: IbkrHealthConfig) -> None:
    if not config.host:
        raise ValueError("host must be non-empty")
    if not 1 <= config.port <= 65535:
        raise ValueError("port must be between 1 and 65535")
    if config.client_id < 0:
        raise ValueError("client_id must be >= 0")
    if not config.collector_id:
        raise ValueError("collector_id must be non-empty")
    if config.account_mode not in {"paper", "live", "unknown"}:
        raise ValueError("account_mode must be one of: paper, live, unknown")
    if not math.isfinite(config.timeout_seconds) or config.timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be a finite value > 0")
    if not config.api_base:
        raise ValueError("api_base must be non-empty")
