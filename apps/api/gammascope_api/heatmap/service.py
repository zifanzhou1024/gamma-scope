from __future__ import annotations

from datetime import UTC, date, datetime, time
from typing import Any, Literal

from gammascope_api.heatmap.exposure import (
    HeatmapContractInput,
    aggregate_exposure_by_strike,
    format_money,
)
from gammascope_api.heatmap.nodes import derive_nodes
from gammascope_api.heatmap.normalization import NEW_YORK_TZ, color_norms_by_strike, market_date_new_york
from gammascope_api.heatmap.repository import HeatmapOiBaselineRecord, HeatmapRepository


HeatmapMetric = Literal["gex", "vex"]
TRADING_CLASS_SPXW = "SPXW"
POSITION_MODE_OI_PROXY = "oi_proxy"
BASELINE_LOCK_TIME_NY = time(9, 25)
STALE_FRESHNESS_MS = 10_000


def build_heatmap_payload(
    snapshot: dict[str, Any],
    metric: HeatmapMetric,
    repository: HeatmapRepository,
) -> dict[str, Any]:
    if metric not in {"gex", "vex"}:
        raise ValueError(f"unsupported heatmap metric: {metric}")

    snapshot_time = _format_datetime(_parse_datetime(str(snapshot["snapshot_time"])))
    symbol = str(snapshot["symbol"])
    expiration_date = str(snapshot["expiry"])
    market_date = market_date_new_york(snapshot_time)
    spot = float(snapshot["spot"])

    persistence_unavailable = False
    try:
        baseline_records = _upsert_baseline_records(
            snapshot=snapshot,
            snapshot_time=snapshot_time,
            market_date=market_date,
            symbol=symbol,
            expiration_date=expiration_date,
            repository=repository,
        )
    except Exception:
        persistence_unavailable = True
        baseline_records = _baseline_records_from_snapshot(
            snapshot=snapshot,
            snapshot_time=snapshot_time,
            market_date=market_date,
            symbol=symbol,
            expiration_date=expiration_date,
        )
    baseline_by_contract = {record.contract_id: record for record in baseline_records}
    exposure_rows = aggregate_exposure_by_strike(
        [
            HeatmapContractInput(
                contract_id=str(row["contract_id"]),
                right=_right(row),
                strike=float(row["strike"]),
                baseline_open_interest=_baseline_open_interest(row, baseline_by_contract),
                custom_gamma=_optional_float(row.get("custom_gamma")),
                custom_vanna=_optional_float(row.get("custom_vanna")),
            )
            for row in snapshot.get("rows", [])
        ],
        spot=spot,
    )

    color_norm_gex = color_norms_by_strike(exposure_rows, "gex")
    color_norm_vex = color_norms_by_strike(exposure_rows, "vex")
    nodes = derive_nodes(exposure_rows, spot=spot, metric=metric)
    rows = [
        _payload_row(
            row,
            metric=metric,
            color_norm_gex=color_norm_gex.get(row.strike, 0),
            color_norm_vex=color_norm_vex.get(row.strike, 0),
        )
        for row in exposure_rows
    ]
    _tag_node_rows(rows, nodes)

    baseline_status = _baseline_status(snapshot_time)
    payload = {
        "sessionId": str(snapshot["session_id"]),
        "symbol": symbol,
        "tradingClass": TRADING_CLASS_SPXW,
        "dte": _dte(market_date, expiration_date),
        "expirationDate": expiration_date,
        "spot": spot,
        "metric": metric,
        "positionMode": POSITION_MODE_OI_PROXY,
        "oiBaselineStatus": baseline_status,
        "oiBaselineCapturedAt": _baseline_captured_at(baseline_records) if baseline_status == "locked" else None,
        "lastSyncedAt": snapshot_time,
        "isLive": snapshot.get("mode") == "live",
        "isStale": _is_stale(snapshot),
        "persistenceStatus": "pending",
        "rows": rows,
        "nodes": nodes,
    }

    if persistence_unavailable:
        payload["persistenceStatus"] = "unavailable"
    else:
        try:
            repository.upsert_heatmap_snapshot(payload)
        except Exception:
            payload["persistenceStatus"] = "unavailable"
        else:
            payload["persistenceStatus"] = "persisted"
    return payload


def _upsert_baseline_records(
    *,
    snapshot: dict[str, Any],
    snapshot_time: str,
    market_date: str,
    symbol: str,
    expiration_date: str,
    repository: HeatmapRepository,
) -> list[HeatmapOiBaselineRecord]:
    records = _baseline_records_from_snapshot(
        snapshot=snapshot,
        snapshot_time=snapshot_time,
        market_date=market_date,
        symbol=symbol,
        expiration_date=expiration_date,
    )
    if not records:
        return []
    return repository.upsert_oi_baseline(records)


def _baseline_records_from_snapshot(
    *,
    snapshot: dict[str, Any],
    snapshot_time: str,
    market_date: str,
    symbol: str,
    expiration_date: str,
) -> list[HeatmapOiBaselineRecord]:
    return [
        HeatmapOiBaselineRecord(
            market_date=market_date,
            symbol=symbol,
            trading_class=TRADING_CLASS_SPXW,
            expiration_date=expiration_date,
            contract_id=str(row["contract_id"]),
            right=str(row["right"]),
            strike=float(row["strike"]),
            open_interest=int(row["open_interest"]),
            observed_at=snapshot_time,
            captured_at=snapshot_time,
            source_snapshot_time=snapshot_time,
        )
        for row in snapshot.get("rows", [])
        if row.get("open_interest") is not None
    ]


def _payload_row(
    row: Any,
    *,
    metric: HeatmapMetric,
    color_norm_gex: float,
    color_norm_vex: float,
) -> dict[str, Any]:
    gex = float(row.gex)
    vex = float(row.vex)
    call_gex = float(row.call_gex)
    put_gex = float(row.put_gex)
    call_vex = float(row.call_vex)
    put_vex = float(row.put_vex)
    if metric == "gex":
        value = gex
        call_value = call_gex
        put_value = put_gex
        color_norm = color_norm_gex
    else:
        value = vex
        call_value = call_vex
        put_value = put_vex
        color_norm = color_norm_vex

    return {
        "strike": float(row.strike),
        "value": value,
        "formattedValue": format_money(value),
        "callValue": call_value,
        "putValue": put_value,
        "colorNorm": color_norm,
        "gex": gex,
        "vex": vex,
        "callGex": call_gex,
        "putGex": put_gex,
        "callVex": call_vex,
        "putVex": put_vex,
        "colorNormGex": color_norm_gex,
        "colorNormVex": color_norm_vex,
        "tags": list(row.tags),
    }


def _tag_node_rows(rows: list[dict[str, Any]], nodes: dict[str, Any]) -> None:
    tag_by_node = {
        "king": "king",
        "aboveWall": "above_wall",
        "belowWall": "below_wall",
    }
    by_strike = {row["strike"]: row for row in rows}
    for node_key, tag in tag_by_node.items():
        node = nodes.get(node_key)
        if node is None:
            continue
        row = by_strike.get(float(node["strike"]))
        if row is not None and tag not in row["tags"]:
            row["tags"].append(tag)


def _baseline_open_interest(row: dict[str, Any], baseline_by_contract: dict[str, HeatmapOiBaselineRecord]) -> int | None:
    baseline = baseline_by_contract.get(str(row["contract_id"]))
    if baseline is None:
        return None
    return baseline.open_interest


def _baseline_status(snapshot_time: str) -> str:
    if _parse_datetime(snapshot_time).astimezone(NEW_YORK_TZ).time() >= BASELINE_LOCK_TIME_NY:
        return "locked"
    return "provisional"


def _baseline_captured_at(records: list[HeatmapOiBaselineRecord]) -> str | None:
    captured = [record.captured_at for record in records if record.captured_at]
    if not captured:
        return None
    return min(captured)


def _dte(market_date: str, expiration_date: str) -> int:
    return max(0, (date.fromisoformat(expiration_date) - date.fromisoformat(market_date)).days)


def _is_stale(snapshot: dict[str, Any]) -> bool:
    freshness_ms = snapshot.get("freshness_ms")
    if freshness_ms is None:
        return False
    try:
        return float(freshness_ms) > STALE_FRESHNESS_MS
    except (TypeError, ValueError):
        return False


def _right(row: dict[str, Any]) -> Literal["call", "put"]:
    right = str(row["right"])
    if right not in {"call", "put"}:
        raise ValueError(f"unsupported option right: {right}")
    return right  # type: ignore[return-value]


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _format_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
