from __future__ import annotations

from gammascope_api.replay.config import replay_baseline_paths
from gammascope_api.replay.dependencies import get_replay_parquet_importer
from gammascope_api.replay.importer import ImportResult, ReplayParquetImporter


def import_local_baseline_if_present(importer: ReplayParquetImporter | None = None) -> ImportResult | None:
    snapshots_path, quotes_path = replay_baseline_paths()
    if not snapshots_path.exists() or not quotes_path.exists():
        return None

    importer = get_replay_parquet_importer() if importer is None else importer
    created = importer.create_import(snapshots_path=snapshots_path, quotes_path=quotes_path)
    if created.status == "awaiting_confirmation":
        return importer.confirm_import(created.import_id)
    if created.status == "completed":
        return created
    return created


if __name__ == "__main__":
    result = import_local_baseline_if_present()
    print("No local replay baseline found." if result is None else result)
