import json
from functools import lru_cache
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "packages" / "contracts" / "fixtures"


@lru_cache
def load_json_fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text())
