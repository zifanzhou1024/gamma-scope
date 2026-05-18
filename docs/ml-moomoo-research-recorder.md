# Moomoo ML Research Recorder

Date: 2026-05-18
Repository: gamma-scope

## Purpose

GammaScope has a local-only Moomoo recorder for machine-learning research. It records raw 0DTE option snapshots for the configured ATM-window universe without changing the live dashboard contract.

The default output folder is:

```text
~/local-ml-data/gamma-ml-research
```

This folder is intentionally outside the repo so large local data is not committed. If you override the output path into the repo, `local-ml-data/` is ignored by git.

## Source Coverage

The recorder uses the same configured Moomoo universe as the collector:

```text
SPX, SPY, QQQ, IWM, RUT, NDX
```

It still selects only the active 0DTE expiry and ATM-centered strike windows. RUT and NDX require manual spot values unless a later source improves index spot resolution:

```bash
pnpm collector:moomoo-research-record -- --spot RUT=2150 --spot NDX=18400
```

## Ticker Naming Contract

Use `ticker` as the canonical training identity across every local ML file. It must be uppercase, provider-independent, and must identify the underlying research ticker, not an option contract, provider code, option family, or spot proxy.

For the current universe, only these top-level ticker names should appear:

```text
SPX, SPY, QQQ, RUT, IWM, NDX
```

Moomoo-specific names stay in source-specific fields:

| Canonical `ticker` | Moomoo owner code | Moomoo option family filter | Notes |
| --- | --- | --- | --- |
| `SPX` | `US..SPX` | `SPXW` | SPX rows remain `ticker=SPX` even when spot is resolved from the SPY proxy. |
| `SPY` | `US.SPY` | none | ETF ticker maps directly. |
| `QQQ` | `US.QQQ` | none | ETF ticker maps directly. |
| `IWM` | `US.IWM` | none | ETF ticker maps directly. |
| `RUT` | `US..RUT` | `RUTW` | Requires manual spot today. |
| `NDX` | `US..NDX` | `NDXP` | Requires manual spot today. |

Rules:

- Top-level `ticker` and `symbol` must match exactly. `symbol` exists only as a compatibility alias.
- Do not write Moomoo region codes such as `US.SPY` or `US..SPX` into `ticker`.
- Do not write option family names such as `SPXW`, `RUTW`, or `NDXP` into `ticker`.
- Do not write option contract codes into `ticker`; use `option_code` and `raw.code` for provider contract identity.
- Do not change `ticker` when a proxy is used for spot. For example, SPX proxy spot can come from `US.SPY`, but the row remains `ticker=SPX`.

## Run Commands

One-loop smoke capture:

```bash
pnpm collector:moomoo-research-record -- --max-loops 1
```

Continuous 10-second capture:

```bash
pnpm collector:moomoo-research-record
```

One regular market session only. If started before 9:30 AM Eastern, it waits for the next weekday open; it exits after 4:00 PM Eastern:

```bash
pnpm collector:moomoo-research-record -- --market-hours
```

Repeat every weekday regular session while the process stays running:

```bash
pnpm collector:moomoo-research-market
```

Automatic macOS LaunchAgent:

```text
~/Library/LaunchAgents/com.sakura.gammascope.moomoo-research-recorder.plist
```

This LaunchAgent starts:

```text
/Users/sakura/WebstormProjects/gamma-scope/ops/run_moomoo_research_market.sh
```

The wrapper runs the market-hours recorder continuously, waits for regular market open, repeats across weekdays, and restarts with a 5-minute backoff if the recorder exits. It writes logs to:

```text
/Users/sakura/local-ml-data/gamma-ml-research/logs/moomoo-research-recorder.out.log
/Users/sakura/local-ml-data/gamma-ml-research/logs/moomoo-research-recorder.err.log
```

Check status:

```bash
launchctl print gui/$(id -u)/com.sakura.gammascope.moomoo-research-recorder
```

Restart after editing args:

```bash
launchctl kickstart -k gui/$(id -u)/com.sakura.gammascope.moomoo-research-recorder
```

Stop automatic collection:

```bash
launchctl bootout gui/$(id -u)/com.sakura.gammascope.moomoo-research-recorder
```

Extra arguments can be placed in:

```text
/Users/sakura/local-ml-data/gamma-ml-research/moomoo-recorder.args
```

Use that file for RUT/NDX manual spots or a 30-second fallback cadence.

Continuous capture with manual RUT/NDX spots:

```bash
pnpm collector:moomoo-research-record -- --spot RUT=2150 --spot NDX=18400
```

Custom output folder:

```bash
pnpm collector:moomoo-research-record -- --output-dir ~/local-ml-data/gamma-ml-research
```

The default cadence is 10 seconds. Use 30 seconds only when collection stability or later feature processing requires it:

```bash
pnpm collector:moomoo-research-record -- --interval-seconds 30 --timeline-seconds 30
```

Market-hours mode uses the normal U.S. regular session:

```text
09:30 AM to 04:00 PM America/New_York
```

It skips weekends. It does not yet embed a full exchange-holiday calendar; on an exchange holiday it may wake during the regular window and record empty or degraded captures unless the process is stopped.

## File Layout

Option rows:

```text
~/local-ml-data/gamma-ml-research/moomoo/options/date=YYYY-MM-DD/ticker=SPX/records.jsonl
```

Underlying/proxy rows:

```text
~/local-ml-data/gamma-ml-research/moomoo/underlyings/date=YYYY-MM-DD/ticker=SPX/records.jsonl
```

Batch rows, one line per capture and ticker with all returned option contracts nested under `contracts`:

```text
~/local-ml-data/gamma-ml-research/moomoo/batches/date=YYYY-MM-DD/ticker=SPX/records.jsonl
```

Capture summaries:

```text
~/local-ml-data/gamma-ml-research/moomoo/captures/date=YYYY-MM-DD/captures.jsonl
```

## File Readability Contract

The files are JSONL: one complete JSON object per line. This is deliberate:

- Easy to append safely if the recorder stops and restarts.
- Easy to inspect with `head`, `jq`, Python, pandas, or PyTorch data loaders.
- Easy to convert later into Parquet after the raw capture is trusted.

Read one day of SPX options in Python:

```python
import json
from pathlib import Path

path = Path("/Users/sakura/local-ml-data/gamma-ml-research/moomoo/options/date=2026-05-19/ticker=SPX/records.jsonl")
rows = [json.loads(line) for line in path.read_text().splitlines()]
```

Read with pandas:

```python
import pandas as pd

df = pd.read_json(
    "/Users/sakura/local-ml-data/gamma-ml-research/moomoo/options/date=2026-05-19/ticker=SPX/records.jsonl",
    lines=True,
)
```

## Record Labeling

The recorder labels rows for future training, but it does not create model target labels yet.

Top-level fields are intentionally stable:

| Field | Meaning |
| --- | --- |
| `schema_version` | Recorder schema version. |
| `source` | Always `moomoo`. |
| `record_type` | `option_snapshot`, `option_snapshot_batch`, `underlying_snapshot`, or `capture_summary`. |
| `capture_id` | Unique capture-loop id. Rows with the same id came from the same recorder cycle. |
| `time_utc` | Canonical local recorder receipt time in UTC. Use this for as-of joins. |
| `captured_at_utc` | Backward-compatible alias for `time_utc`. |
| `time_bucket_utc` | Canonical capture time floored to the configured 10-second or 30-second grid. |
| `timeline_bucket_utc` | Backward-compatible alias for `time_bucket_utc`. |
| `timeline_seconds` | Grid size used to calculate `time_bucket_utc`. Defaults to `10`. |
| `market_date` | New York market date. |
| `ticker` | Canonical training ticker such as `SPX`, `SPY`, `QQQ`, `IWM`, `RUT`, or `NDX`. |
| `symbol` | Backward-compatible alias for `ticker`. |
| `expiry` | Target 0DTE option expiry. |
| `option_code` | Moomoo option contract code. Option rows only. |
| `strike` | Contract strike as a number. Option rows only. |
| `right` | `call` or `put`. Option rows only. |
| `provider_update_time` | Moomoo's update time when supplied. Do not use it as the primary timeline key. |
| `raw` | Full provider payload. This is the source of truth. |
| `normalized` | Convenience projection used by GammaScope today. Do not treat it as the full dataset. |

The primary training-time key should be:

```text
source + market_date + ticker + expiry + time_utc + option_code
```

For alignment across Moomoo and GEXBot, use:

```text
market_date + ticker + time_bucket_utc
```

Do not interpret `time_bucket_utc` as proof that the provider updated exactly at that second. It is a capture-grid label for joining and gap detection.

Batch rows use the same top-level labels. Each batch row has:

| Field | Meaning |
| --- | --- |
| `record_type` | Always `option_snapshot_batch`. |
| `ticker` | Canonical ticker for this capture batch. |
| `contract_count` | Number of option contracts returned by Moomoo for that ticker in this capture. |
| `contracts` | Nested list of returned contracts. Each item includes `option_code`, `strike`, `right`, `provider_update_time`, `raw`, and `normalized`. |

## Raw-First Rule

Do not drop, rename, or reshape Moomoo raw fields at collection time. The current recorder keeps fields such as:

- `option_net_open_interest`
- `option_premium`
- `option_contract_nominal_value`
- `option_expiry_date_distance`
- `bid_ask_ratio`
- pre-market, after-hours, and overnight fields
- any future unknown provider fields

Later preprocessing can decide what to keep. The recorder's job is to preserve enough information to re-run feature engineering without re-collecting the day.

Each row has UTC timing fields for later synchronization:

- `time_utc`
- `time_bucket_utc`
- `captured_at_utc`
- `timeline_bucket_utc`
- `market_date`
- `expiry`
- `ticker`
- `symbol`
- `option_code`
- `strike`
- `right`
- `provider_update_time`

Each option row also stores:

- `raw`: the full Moomoo `get_market_snapshot()` row.
- `normalized`: GammaScope's current normalized convenience fields.

Each batch row stores:

- `contracts[].raw`: the full Moomoo `get_market_snapshot()` row for each returned contract in that capture.
- `contracts[].normalized`: the same convenience projection as the flat option rows.

For ML, treat `raw` as the source of truth. The normalized block is only for easy inspection and compatibility.

## Timeline Alignment

The intended training dataset should be built from raw files using a fixed exchange-time grid:

```text
09:30:00 ET
09:30:10 ET
09:30:20 ET
...
16:00:00 ET
```

For each timeline row at time `t`, use only rows with `time_utc <= t`.

Recommended join tolerances:

- Moomoo: 15 seconds on a 10-second grid.
- GEXBot: 2 to 5 minutes, depending on observed update speed.

Do not use nearest joins that can pull future data. Use backward/as-of joins only.

## Modeling Note

Train in stages:

1. Moomoo-only baseline model.
2. GEXBot-only baseline model.
3. Fused model using the aligned timeline.

This prevents a weak or stale source from hiding inside a blended model. Keep the fused model only if walk-forward tests show it improves out-of-sample performance.
