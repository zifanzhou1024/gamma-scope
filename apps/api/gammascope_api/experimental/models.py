from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Any, Literal


PanelStatus = Literal["ok", "preview", "insufficient_data", "error"]


@dataclass(frozen=True)
class StrikePair:
    strike: float
    call: dict[str, Any] | None
    put: dict[str, Any] | None


def diagnostic(code: str, message: str, severity: Literal["info", "warning", "error"] = "info") -> dict[str, str]:
    return {"code": code, "message": message, "severity": severity}


def panel(
    status: PanelStatus,
    label: str,
    diagnostics: list[dict[str, str]] | None = None,
    **values: Any,
) -> dict[str, Any]:
    return {"status": status, "label": label, "diagnostics": diagnostics or [], **values}


def optional_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if isfinite(result) else None
