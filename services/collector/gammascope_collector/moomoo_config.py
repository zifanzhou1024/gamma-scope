from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field, replace
from math import ceil, isfinite

DEFAULT_MOOMOO_HOST = "127.0.0.1"
DEFAULT_MOOMOO_PORT = 11111
DEFAULT_REFRESH_INTERVAL_SECONDS = 2.0
SNAPSHOT_CODE_LIMIT = 400
SNAPSHOT_REQUEST_LIMIT_PER_30_SECONDS = 60


@dataclass(frozen=True)
class MoomooSymbolConfig:
    symbol: str
    owner_code: str
    strike_window_down: int
    strike_window_up: int
    enabled: bool = True
    publish_to_spx_dashboard: bool = False
    family_filter: str | None = None
    requires_manual_spot: bool = False
    manual_spot: float | None = None
    priority: int = 100

    @property
    def strike_count(self) -> int:
        return self.strike_window_down + 1 + self.strike_window_up

    @property
    def contract_count(self) -> int:
        return self.strike_count * 2

    def with_manual_spot(self, spot: float | None) -> MoomooSymbolConfig:
        return replace(self, manual_spot=spot)


@dataclass(frozen=True)
class SnapshotRateEstimate:
    codes: int
    requests_per_refresh: int
    requests_per_30_seconds: int
    within_limit: bool


@dataclass(frozen=True)
class MoomooCollectorConfig:
    host: str = DEFAULT_MOOMOO_HOST
    port: int = DEFAULT_MOOMOO_PORT
    refresh_interval_seconds: float = DEFAULT_REFRESH_INTERVAL_SECONDS
    collector_id: str = "local-moomoo"
    api_base: str = "http://127.0.0.1:8000"
    manual_spots: dict[str, float] = field(default_factory=dict)
    universe: Sequence[MoomooSymbolConfig] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if self.refresh_interval_seconds <= 0:
            raise ValueError("refresh_interval_seconds must be greater than zero")
        if not self.universe:
            object.__setattr__(self, "universe", tuple(default_moomoo_universe()))


def default_moomoo_universe() -> list[MoomooSymbolConfig]:
    return [
        MoomooSymbolConfig(
            symbol="SPX",
            owner_code="US..SPX",
            strike_window_down=30,
            strike_window_up=30,
            publish_to_spx_dashboard=True,
            family_filter="SPXW",
            requires_manual_spot=True,
            priority=10,
        ),
        MoomooSymbolConfig(
            symbol="SPY",
            owner_code="US.SPY",
            strike_window_down=15,
            strike_window_up=15,
            priority=30,
        ),
        MoomooSymbolConfig(
            symbol="QQQ",
            owner_code="US.QQQ",
            strike_window_down=15,
            strike_window_up=15,
            priority=30,
        ),
        MoomooSymbolConfig(
            symbol="IWM",
            owner_code="US.IWM",
            strike_window_down=10,
            strike_window_up=10,
            priority=40,
        ),
        MoomooSymbolConfig(
            symbol="RUT",
            owner_code="US..RUT",
            strike_window_down=20,
            strike_window_up=20,
            family_filter="RUTW",
            requires_manual_spot=True,
            priority=50,
        ),
        MoomooSymbolConfig(
            symbol="NDX",
            owner_code="US..NDX",
            strike_window_down=50,
            strike_window_up=50,
            family_filter="NDXP",
            requires_manual_spot=True,
            priority=60,
        ),
    ]


def parse_manual_spots(values: Iterable[str]) -> dict[str, float]:
    spots: dict[str, float] = {}
    for raw_value in values:
        if "=" not in raw_value:
            raise ValueError(f"Manual spot must use SYMBOL=VALUE format: {raw_value}")
        raw_symbol, raw_spot = raw_value.split("=", 1)
        symbol = raw_symbol.strip().upper()
        if not symbol:
            raise ValueError("Manual spot symbol must be non-empty")
        try:
            spot = float(raw_spot.strip())
        except ValueError as exc:
            raise ValueError(f"Manual spot for {symbol} must be numeric") from exc
        if not isfinite(spot) or spot <= 0:
            raise ValueError(f"Manual spot for {symbol} must be greater than zero")
        spots[symbol] = spot
    return spots


def selected_symbols(config: MoomooCollectorConfig) -> list[MoomooSymbolConfig]:
    selected: list[MoomooSymbolConfig] = []
    for item in config.universe:
        if not item.enabled:
            continue
        selected.append(item.with_manual_spot(config.manual_spots.get(item.symbol.upper(), item.manual_spot)))
    return selected


def chunked(items: Sequence[str], size: int) -> Iterator[list[str]]:
    if size <= 0:
        raise ValueError("chunk size must be greater than zero")
    for index in range(0, len(items), size):
        yield list(items[index : index + size])


def estimate_snapshot_request_rate(
    code_count: int,
    refresh_interval_seconds: float,
    *,
    code_limit: int = SNAPSHOT_CODE_LIMIT,
    request_limit_per_30_seconds: int = SNAPSHOT_REQUEST_LIMIT_PER_30_SECONDS,
) -> SnapshotRateEstimate:
    if refresh_interval_seconds <= 0:
        raise ValueError("refresh_interval_seconds must be greater than zero")
    requests_per_refresh = ceil(code_count / code_limit) if code_count > 0 else 0
    requests_per_30_seconds = ceil(requests_per_refresh * (30 / refresh_interval_seconds))
    return SnapshotRateEstimate(
        codes=code_count,
        requests_per_refresh=requests_per_refresh,
        requests_per_30_seconds=requests_per_30_seconds,
        within_limit=requests_per_30_seconds <= request_limit_per_30_seconds,
    )
