from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
from typing import Any

from gammascope_api.replay.archive import archive_replay_files, describe_source_file
from gammascope_api.replay.import_repository import ImportRecord, ReplayImportRepository
from gammascope_api.replay.parquet_reader import iter_replay_quote_records, read_replay_parquet_pair


DEFAULT_IMPORT_SYMBOL = "SPX"
DEFAULT_IMPORT_SCOPE = "0DTE"


@dataclass(frozen=True)
class ImportResult:
    import_id: str
    status: str
    summary: dict[str, Any]
    warnings: list[str]
    errors: list[str]
    session_id: str | None = None
    replay_url: str | None = None


class ReplayParquetImporter:
    def __init__(self, *, repository: ReplayImportRepository, archive_dir: Path | str) -> None:
        self.repository = repository
        self.archive_dir = Path(archive_dir)

    def create_import(self, *, snapshots_path: Path | str, quotes_path: Path | str) -> ImportResult:
        snapshots_path = Path(snapshots_path)
        quotes_path = Path(quotes_path)
        snapshots_info = describe_source_file(snapshots_path)
        quotes_info = describe_source_file(quotes_path)
        completed_duplicate = self.repository.find_duplicate_checksum_import(
            snapshots_sha256=snapshots_info.sha256,
            quotes_sha256=quotes_info.sha256,
        )
        if completed_duplicate is not None and completed_duplicate.status != "completed":
            completed_duplicate = None

        import_record = self.repository.create_import(
            snapshots_filename=snapshots_info.filename,
            quotes_filename=quotes_info.filename,
            snapshots_sha256=snapshots_info.sha256,
            quotes_sha256=quotes_info.sha256,
            snapshots_size=snapshots_info.size,
            quotes_size=quotes_info.size,
            snapshots_archive_path=str(self.archive_dir / "pending" / "snapshots.parquet"),
            quotes_archive_path=str(self.archive_dir / "pending" / "quotes.parquet"),
        )
        self.repository.mark_validating(import_record.import_id)

        try:
            archive = archive_replay_files(
                snapshots_path=snapshots_path,
                quotes_path=quotes_path,
                archive_dir=self.archive_dir,
                import_id=import_record.import_id,
            )
        except Exception as exc:
            errors = [str(exc)]
            self.repository.save_validation(import_record.import_id, summary={}, warnings=[], errors=errors)
            self.repository.mark_failed(import_record.import_id, errors=errors)
            return self._result_from_record(self.repository.get_import(import_record.import_id))

        self.repository.save_archive_metadata(
            import_record.import_id,
            snapshots_archive_path=str(archive.snapshots_path),
            quotes_archive_path=str(archive.quotes_path),
            snapshots_sha256=archive.snapshots_sha256,
            quotes_sha256=archive.quotes_sha256,
            snapshots_size=archive.snapshots_size,
            quotes_size=archive.quotes_size,
        )

        read_result = read_replay_parquet_pair(
            snapshots_path=archive.snapshots_path,
            quotes_path=archive.quotes_path,
            session_id="preview",
            load_quotes=False,
        )
        summary = self._summary_with_import_metadata(
            read_result.summary,
            snapshots=read_result.snapshots,
            snapshots_sha256=archive.snapshots_sha256,
            quotes_sha256=archive.quotes_sha256,
            snapshots_size=archive.snapshots_size,
            quotes_size=archive.quotes_size,
            snapshots_archive_path=archive.snapshots_path,
            quotes_archive_path=archive.quotes_path,
        )
        warnings = list(read_result.warnings)
        if read_result.errors:
            self.repository.save_validation(
                import_record.import_id,
                summary=summary,
                warnings=warnings,
                errors=read_result.errors,
            )
            self.repository.mark_failed(import_record.import_id, errors=read_result.errors)
            return self._result_from_record(self.repository.get_import(import_record.import_id))

        session_id = self._stable_session_id(summary)
        if completed_duplicate is not None and completed_duplicate.session_id is not None:
            session_id = completed_duplicate.session_id
            summary["duplicate_session_id"] = completed_duplicate.session_id
            summary["duplicate_import_id"] = completed_duplicate.import_id
            warnings.append(f"duplicate checksum matches completed import {completed_duplicate.import_id}")

        self.repository.save_validation(import_record.import_id, summary=summary, warnings=warnings, errors=[])
        self.repository.mark_awaiting_confirmation(import_record.import_id, session_id=session_id)
        return self._result_from_record(self.repository.get_import(import_record.import_id))

    def get_import(self, import_id: str) -> ImportResult:
        return self._result_from_record(self.repository.get_import(import_id))

    def confirm_import(self, import_id: str) -> ImportResult:
        import_record = self.repository.get_import(import_id)
        if import_record.status == "completed":
            return self._completed_result(import_record)
        if import_record.status != "awaiting_confirmation":
            return self._invalid_transition_result(import_record, action="confirm")
        if import_record.session_id is None:
            errors = ["Cannot confirm import without a replay session id"]
            self.repository.mark_failed(import_id, errors=errors)
            return self._result_from_record(self.repository.get_import(import_id))

        duplicate_session_id = import_record.validation_summary.get("duplicate_session_id")
        if isinstance(duplicate_session_id, str) and duplicate_session_id:
            self.repository.mark_publishing(import_id)
            self.repository.mark_completed(import_id, session_id=duplicate_session_id)
            return self._completed_result(self.repository.get_import(import_id))

        self.repository.mark_publishing(import_id)
        read_result = read_replay_parquet_pair(
            snapshots_path=Path(import_record.snapshots_archive_path),
            quotes_path=Path(import_record.quotes_archive_path),
            session_id=import_record.session_id,
            load_quotes=False,
        )
        summary = self._summary_with_import_metadata(
            read_result.summary,
            snapshots=read_result.snapshots,
            snapshots_sha256=import_record.snapshots_sha256,
            quotes_sha256=import_record.quotes_sha256,
            snapshots_size=import_record.snapshots_size,
            quotes_size=import_record.quotes_size,
            snapshots_archive_path=Path(import_record.snapshots_archive_path),
            quotes_archive_path=Path(import_record.quotes_archive_path),
        )
        if read_result.errors:
            self.repository.save_validation(
                import_id,
                summary=summary,
                warnings=[*import_record.validation_warnings, *read_result.warnings],
                errors=read_result.errors,
            )
            self.repository.mark_failed(import_id, errors=read_result.errors)
            return self._result_from_record(self.repository.get_import(import_id))

        self.repository.save_validation(
            import_id,
            summary=summary,
            warnings=import_record.validation_warnings,
            errors=[],
        )
        quote_records = iter_replay_quote_records(
            quotes_path=Path(import_record.quotes_archive_path),
            snapshot_id_map=read_result.snapshot_id_map,
            session_id=import_record.session_id,
            expiry=summary["expiry"],
        )
        try:
            self.repository.publish_import(
                import_id=import_id,
                session_id=import_record.session_id,
                symbol=summary["symbol"],
                expiry=summary["expiry"],
                start_time=summary["start_time"],
                end_time=summary["end_time"],
                snapshots=read_result.snapshots,
                quotes=quote_records,
            )
        except Exception as exc:
            errors = [str(exc)]
            self.repository.save_validation(
                import_id,
                summary=summary,
                warnings=import_record.validation_warnings,
                errors=errors,
            )
            self.repository.mark_failed(import_id, errors=errors)
            return self._result_from_record(self.repository.get_import(import_id))

        return self._completed_result(self.repository.get_import(import_id))

    def cancel_import(self, import_id: str) -> ImportResult:
        import_record = self.repository.get_import(import_id)
        if import_record.status in {"uploaded", "validating", "awaiting_confirmation"}:
            self.repository.mark_cancelled(import_id)
            return self._result_from_record(self.repository.get_import(import_id))
        return self._invalid_transition_result(import_record, action="cancel")

    def _summary_with_import_metadata(
        self,
        summary: dict[str, Any],
        *,
        snapshots: list[Any],
        snapshots_sha256: str,
        quotes_sha256: str,
        snapshots_size: int,
        quotes_size: int,
        snapshots_archive_path: Path,
        quotes_archive_path: Path,
    ) -> dict[str, Any]:
        enriched = dict(summary)
        if snapshots:
            start_time = snapshots[0].snapshot_time
            end_time = snapshots[-1].snapshot_time
            enriched.update(
                {
                    "symbol": DEFAULT_IMPORT_SYMBOL,
                    "scope": DEFAULT_IMPORT_SCOPE,
                    "trade_date": start_time[:10],
                    "start_time": start_time,
                    "end_time": end_time,
                }
            )
        enriched.update(
            {
                "snapshots_sha256": snapshots_sha256,
                "quotes_sha256": quotes_sha256,
                "snapshots_size": snapshots_size,
                "quotes_size": quotes_size,
                "snapshots_archive_path": str(snapshots_archive_path),
                "quotes_archive_path": str(quotes_archive_path),
            }
        )
        return enriched

    def _stable_session_id(self, summary: dict[str, Any]) -> str:
        start_timestamp = (
            summary["start_time"]
            .replace("-", "")
            .replace(":", "")
            .replace("T", "-")
            .replace("Z", "")
        )
        checksum_prefix = hashlib.sha256(
            f"{summary['snapshots_sha256']}:{summary['quotes_sha256']}".encode()
        ).hexdigest()[:10]
        return (
            f"replay-{summary['symbol'].lower()}-{summary['scope'].lower()}-"
            f"{summary['trade_date']}-{start_timestamp}-{checksum_prefix}"
        )

    def _result_from_record(self, import_record: ImportRecord) -> ImportResult:
        return ImportResult(
            import_id=import_record.import_id,
            status=import_record.status,
            summary=import_record.validation_summary,
            warnings=import_record.validation_warnings,
            errors=[] if import_record.status == "completed" else import_record.validation_errors,
            session_id=import_record.session_id,
            replay_url=self._replay_url(import_record.session_id) if import_record.status == "completed" else None,
        )

    def _completed_result(self, import_record: ImportRecord) -> ImportResult:
        return ImportResult(
            import_id=import_record.import_id,
            status="completed",
            summary=import_record.validation_summary,
            warnings=import_record.validation_warnings,
            errors=[],
            session_id=import_record.session_id,
            replay_url=self._replay_url(import_record.session_id),
        )

    def _invalid_transition_result(self, import_record: ImportRecord, *, action: str) -> ImportResult:
        result = self._result_from_record(import_record)
        errors = result.errors or [f"Cannot {action} import from status {import_record.status}"]
        return ImportResult(
            import_id=result.import_id,
            status=result.status,
            summary=result.summary,
            warnings=result.warnings,
            errors=errors,
            session_id=result.session_id,
            replay_url=result.replay_url,
        )

    def _replay_url(self, session_id: str | None) -> str | None:
        if session_id is None:
            return None
        return f"/replay?session_id={session_id}"
