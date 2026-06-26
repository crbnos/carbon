import type {
  CheckStateRow,
  DetectSignal,
  GateValue,
  NestedProductStep,
  StepDef,
  Tier
} from "../types";

// Resolve a spine for a tier: drop nested product steps that don't apply to the
// tier (e.g. net-new work + hosting are paid-tier only). Filtering at the source
// keeps gate status, progress counts, and the "next step" all consistent —
// excluded steps never count toward a self-serve gate.
export function nestedForTier(step: StepDef, tier: Tier): NestedProductStep[] {
  return (step.nested ?? []).filter((n) => !n.tiers || n.tiers.includes(tier));
}

export function spineForTier(spine: StepDef[], tier: Tier): StepDef[] {
  return spine
    .filter((step) => !step.tiers || step.tiers.includes(tier))
    .map((step, i) => ({
      // Renumber by position so dropping a gate (e.g. Acceptance for self-serve)
      // leaves no gap in the displayed 1..N sequence.
      ...step,
      n: i + 1,
      ...(step.nested ? { nested: nestedForTier(step, tier) } : {})
    }));
}

// Auto-detected signals from real Carbon data (computed server-side, never
// persisted). Manual overrides in checkState always win.
export type Signals = Record<DetectSignal, boolean>;

export function stateMap(rows: CheckStateRow[]): Map<string, string> {
  return new Map(rows.map((r) => [r.itemKey, r.value]));
}

// Resolve a fill-in field's value: the per-company override if present, else the
// code template's default.
export function fieldMap(
  rows: { fieldKey: string; value: string }[]
): Map<string, string> {
  return new Map(rows.map((r) => [r.fieldKey, r.value]));
}

// A nested product step is done if its manual override says so, else if its
// detection signal fires. `detect: null` (e.g. MRP) is manual-only.
export function effectiveProductStatus(
  step: NestedProductStep,
  states: Map<string, string>,
  signals: Signals
): GateValue {
  const manual = states.get(step.key) as GateValue | undefined;
  if (manual) return manual;
  if (step.detect && signals[step.detect]) return "done";
  return "todo";
}

// Gate status resolution. An EXPLICIT manual value (set by clicking the gate)
// wins both ways — it can force a gate done, or force it back to todo even when
// every nested step auto-detects as done. Without that, a gate fed by an
// auto-detected step (e.g. `hasItems`) could never be un-checked. Only when no
// manual value is stored does the gate derive from its nested product steps:
// all done => done, some done => in progress, else todo. This keeps auto-advance
// working for untouched gates while letting a human override stick.
export function effectiveGateStatus(
  step: StepDef,
  states: Map<string, string>,
  signals: Signals
): GateValue {
  const manual = states.get(step.key) as GateValue | undefined;
  if (manual) return manual;

  const nested = step.nested ?? [];
  if (nested.length > 0) {
    const doneCount = nested.filter(
      (n) => effectiveProductStatus(n, states, signals) === "done"
    ).length;
    if (doneCount === nested.length) return "done";
    if (doneCount > 0) return "prog";
  }

  return "todo";
}

export function gatesDone(
  steps: StepDef[],
  states: Map<string, string>,
  signals: Signals
): number {
  return steps.filter((s) => effectiveGateStatus(s, states, signals) === "done")
    .length;
}

export function gatesRemaining(
  steps: StepDef[],
  states: Map<string, string>,
  signals: Signals
): number {
  return steps.length - gatesDone(steps, states, signals);
}
