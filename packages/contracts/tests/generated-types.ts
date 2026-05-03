import type { AnalyticsSnapshot } from "../src/generated/analytics-snapshot";
import type { CollectorEvents } from "../src/generated/collector-events";
import type { ExperimentalAnalytics } from "../src/generated/experimental-analytics";
import type { ExperimentalFlow } from "../src/generated/experimental-flow";
import type { SavedView } from "../src/generated/saved-view";
import type { ScenarioRequest } from "../src/generated/scenario";

type _SnapshotSchemaVersion = AnalyticsSnapshot["schema_version"];
type _CollectorEvent = CollectorEvents;
type _ExperimentalPanelStatus = ExperimentalAnalytics["forwardSummary"]["status"];
type _ExperimentalFlowSchemaVersion = ExperimentalFlow["schema_version"];
type _ScenarioShift = ScenarioRequest["vol_shift_points"];
type _SavedViewMode = SavedView["mode"];

const _ExperimentalRejectsExtraForwardField: ExperimentalAnalytics["forwardSummary"] = {
  status: "ok",
  label: "Forward and expected move",
  diagnostics: [],
  parityForward: 5200,
  forwardMinusSpot: 0,
  atmStrike: 5200,
  atmStraddle: 18,
  expectedRange: { lower: 5182, upper: 5218 },
  expectedMovePercent: 0.0035,
  // @ts-expect-error Experimental panels are closed by the shared JSON Schema.
  unexpected: 123
};
