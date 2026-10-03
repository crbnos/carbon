// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Every rule the assembly screen decides by, with no React and no
 * `react-native` import — so it is unit-testable, and so a phone and a tablet
 * cannot disagree about which unit is being built or whether a step is done.
 *
 * All of it is a port of `apps/mes/app/components/AssemblyView.tsx` and
 * `apps/mes/app/utils/units.ts`. The LAYOUT above it is this app's own — web
 * has three columns and a phone has one — but the arithmetic is web's, kept
 * line for line where it could be, because an operator who records a step on a
 * tablet and reopens the job in a browser must find the same unit on the same
 * step with the same parts issued. The ONE place it departs from web is marked
 * where it happens (`materialStates`, an operation with no steps).
 *
 * The types here are structural and minimal on purpose: they name only what a
 * rule reads, so the wire contract's fuller rows satisfy them and a test can
 * build one in a line.
 */

export type StepRecord = {
  id: string;
  /** The unit-axis position this record belongs to. */
  index: number;
  value?: string | null;
  numericValue?: number | null;
  booleanValue?: boolean | null;
  userValue?: string | null;
  createdBy?: string | null;
};

export type AssemblyStep = {
  id: string;
  name?: string | null;
  type?: string | null;
  sortOrder?: number | null;
  minValue?: number | null;
  maxValue?: number | null;
  unitOfMeasureCode?: string | null;
  jobOperationStepRecord?: StepRecord[] | null;
};

export type AssemblyMaterial = {
  id?: string | null;
  itemType?: string | null;
  /** The per-unit BOM quantity. */
  quantity?: number | null;
  estimatedQuantity?: number | null;
  quantityIssued?: number | null;
  requiresSerialTracking?: boolean | null;
  requiresBatchTracking?: boolean | null;
  /** The steps this part is assigned to; empty means unassigned ("General"). */
  jobOperationStepIds?: string[] | null;
  /** A BOM line split across steps: this step's share, when one is set. */
  jobOperationStepQuantities?: Record<string, number | null> | null;
};

export type AssemblyTool = {
  jobOperationStepIds?: string[] | null;
};

export type TrackedUnit = {
  id: string;
  status?: string | null;
  attributes?: unknown;
};

export type Unit<E> = { index: number; entity: E | null };

/** Steps in the order they are built. Ties keep their arrival order. */
export function sortSteps<S extends AssemblyStep>(steps: S[]): S[] {
  return [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/**
 * How many units the operator pages through.
 *
 * The operation quantity, whole and at least one — so a missing, zero or NaN
 * quantity still gives a single shared unit rather than an empty screen. With
 * no quantity at all it falls back to the number of tracked entities.
 *
 * `Math.round` here is not rounding a value for display or storage: the unit
 * axis is a COUNT of things to page through, and it is the same call
 * `apps/mes/app/utils/units.ts` makes, so a quantity of 4.5 gives both clients
 * the same five units.
 */
export function unitCount(
  operationQuantity: number | null | undefined,
  entityCount: number
) {
  const raw = operationQuantity ?? entityCount;
  return Math.max(1, Math.round(Number.isFinite(raw) ? raw : 1));
}

/**
 * Units already built, as a whole count — what the next unit to build is
 * indexed by. Web rounds it the same way (`Math.round(quantityComplete)`), for
 * the same reason as `unitCount`: it positions a pager, it is not stored.
 */
export function completedUnits(quantityComplete: number | null | undefined) {
  const raw = quantityComplete ?? 0;
  return Math.max(0, Math.round(Number.isFinite(raw) ? raw : 0));
}

/**
 * A typed measurement as a number, or null when it is not one.
 *
 * Not `parseQuantity`: a measurement may be zero or negative (an offset, a
 * deviation from nominal), and refusing those would leave an inspector unable
 * to record a perfectly good reading. Still strict about the rest — no hex,
 * no exponent, no thousands separators — because `Number(" ")` is 0 and a
 * blank field must not record a zero.
 */
export function parseMeasurement(text: string) {
  const trimmed = text.trim();
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** What a step's chip in the steps bar shows for one unit. */
export function stepChipState(
  step: AssemblyStep,
  unitIndex: number
): "bad" | "done" | "todo" {
  if (isStepBadResult(step, unitIndex)) return "bad";
  return isStepDone(step, unitIndex) ? "done" : "todo";
}

/**
 * The unit axis: one entry per unit to build, each bound to its tracked entity
 * where it has one.
 *
 * - Serial: unit i is bound to entity i.
 * - Batch: there is one lot; unit 0 carries it and the rest carry none.
 * - Untracked: no unit carries anything.
 *
 * Entities beyond `count` are ignored — a job may pre-generate more serials
 * than it builds — and a `count` longer than the list leaves the surplus
 * unbound.
 */
export function deriveUnits<E>(
  count: number,
  entities?: readonly E[] | null
): Unit<E>[] {
  const list = entities ?? [];
  return Array.from({ length: count }, (_, index) => ({
    index,
    entity: list[index] ?? null
  }));
}

/**
 * A serial unit is still to be built at this operation when it carries no
 * completion marker for it and has not left the flow.
 *
 * The marker is the literal attribute key `Operation <jobOperationId>` — the
 * string the server writes on completion, so the format is a contract. Note
 * this is NOT the inspection screen's rule: there `Rejected` also closes a
 * unit, and here it does not, because a rejected unit can still be reworked
 * through this operation.
 */
export function isUnitIncompleteForOperation(
  entity: TrackedUnit,
  operationId: string
) {
  const attributes = (entity.attributes ?? {}) as Record<string, unknown>;
  return (
    !(`Operation ${operationId}` in attributes) &&
    entity.status !== "Consumed" &&
    entity.status !== "Scrapped"
  );
}

/**
 * Which unit the screen is on.
 *
 * In order: the tracked entity that was asked for (serial parents only — they
 * are the only ones with an entity per unit), then an explicit unit index, then
 * the next unit still to build. That last default is `quantityComplete`, not
 * zero, so reopening a job lands on the unit being built rather than on one
 * that was finished yesterday.
 */
export function resolveUnitIndex<E extends { id: string }>(args: {
  units: Unit<E>[];
  navigatesByEntity: boolean;
  trackedEntityId: string | null | undefined;
  unitParam: number | null | undefined;
  quantityComplete: number;
}) {
  const { units } = args;
  if (args.navigatesByEntity && args.trackedEntityId) {
    const found = units.findIndex((u) => u.entity?.id === args.trackedEntityId);
    if (found >= 0) return found;
  }
  if (
    args.unitParam != null &&
    Number.isInteger(args.unitParam) &&
    args.unitParam >= 0 &&
    args.unitParam < units.length
  ) {
    return args.unitParam;
  }
  return Math.min(
    Math.max(0, args.quantityComplete),
    Math.max(0, units.length - 1)
  );
}

/** This unit's record of a step, if it has one. */
export function recordFor(step: AssemblyStep, unitIndex: number) {
  return (step.jobOperationStepRecord ?? []).find((r) => r.index === unitIndex);
}

/**
 * A step is done for a unit when a record EXISTS for it.
 *
 * Deliberately the row, not the value in it: an Inspection recorded as "fail"
 * is done-and-bad, not undone, and Undo deletes the row rather than clearing
 * it. (The operation screen's own tab reads the value instead; the two views
 * differ on the web as well.)
 */
export function isStepDone(step: AssemblyStep, unitIndex: number) {
  return recordFor(step, unitIndex) !== undefined;
}

/**
 * A recorded step whose value fails its acceptance criteria: a Measurement
 * outside `[min, max]`, or an Inspection recorded as not passing.
 */
export function isStepBadResult(step: AssemblyStep, unitIndex: number) {
  const record = recordFor(step, unitIndex);
  if (!record) return false;
  if (step.type === "Measurement") {
    const value = record.numericValue;
    if (value == null) return false;
    return (
      (step.minValue != null && value < step.minValue) ||
      (step.maxValue != null && value > step.maxValue)
    );
  }
  if (step.type === "Inspection") return record.booleanValue === false;
  return false;
}

/** Any out-of-spec record on this unit — flags it red in the unit list. */
export function unitHasBadResult(steps: AssemblyStep[], unitIndex: number) {
  return steps.some((step) => isStepBadResult(step, unitIndex));
}

/** Every step recorded for this unit. False when there are no steps at all. */
export function unitIsRecorded(steps: AssemblyStep[], unitIndex: number) {
  return steps.length > 0 && steps.every((step) => isStepDone(step, unitIndex));
}

/** The first step this unit has not recorded, or -1 when all are. */
export function firstIncompleteStep(steps: AssemblyStep[], unitIndex: number) {
  return steps.findIndex((step) => !isStepDone(step, unitIndex));
}

/** What a done step shows: the recorded value in the operator's own terms. */
export function recordedDisplay(step: AssemblyStep, record: StepRecord) {
  let text: string | null = null;
  if (record.numericValue != null) {
    text = `${record.numericValue}${
      step.unitOfMeasureCode ? ` ${step.unitOfMeasureCode}` : ""
    }`;
  } else if (record.booleanValue != null) {
    text = record.booleanValue ? "Yes" : "No";
  } else if (record.value) {
    text = record.value;
  } else if (record.userValue) {
    text = record.userValue;
  }
  // A File step stores a storage path; the file name is the readable part.
  if (step.type === "File" && text) return text.split("/").pop() || text;
  return text;
}

/** Web's `TYPE_ORDER`: how parts are grouped within a step. */
const TYPE_ORDER = [
  "Part",
  "Material",
  "Consumable",
  "Fixture",
  "Tool",
  "Service"
];

/**
 * The parts shown on a step.
 *
 * A part appears ONLY on the step or steps it is assigned to. A part with no
 * assignment is "General" and appears on the FIRST step only: loose parts are
 * backflushed when a unit's first step is recorded, so that is where the
 * operator handles them, and repeating them on every step would bury the parts
 * that are specific to it. Assigned parts first, General after; within each,
 * by item type.
 */
export function visibleMaterials<M extends AssemblyMaterial>(
  materials: M[],
  step: AssemblyStep | null,
  stepIndex: number
): M[] {
  const onStep = (m: M) =>
    step != null && (m.jobOperationStepIds ?? []).includes(step.id);
  const isGeneral = (m: M) => (m.jobOperationStepIds ?? []).length === 0;
  const typeRank = (m: M) => {
    const rank = TYPE_ORDER.indexOf(m.itemType ?? "");
    return rank < 0 ? 99 : rank;
  };
  return materials
    .filter((m) => onStep(m) || (stepIndex === 0 && isGeneral(m)))
    .sort(
      (a, b) =>
        (onStep(a) ? 0 : 1) - (onStep(b) ? 0 : 1) || typeRank(a) - typeRank(b)
    );
}

/**
 * The tools for a step: those linked to it, plus operation-level tools (no
 * links), which belong to every step.
 */
export function stepTools<T extends AssemblyTool>(
  tools: T[],
  step: AssemblyStep | null
): T[] {
  return tools.filter((tool) => {
    const ids = tool.jobOperationStepIds ?? [];
    return ids.length === 0 || (step != null && ids.includes(step.id));
  });
}

/**
 * How much of a part this unit needs and has.
 *
 * The requirement is always the PER-UNIT quantity. Serial and batch parents
 * are sent a per-unit issued figure for tracked parts; everything else is sent
 * a job-wide total, from which this unit's share is derived by assuming each
 * earlier unit consumed its own. An unplanned extra (required 0) has no share
 * to derive, so its raw total is shown. `issuedOverride` short-circuits both —
 * it is how an untracked part reads as issued the moment its owning step is
 * recorded, mirroring the server's backflush.
 */
export function issuedForUnit(
  material: AssemblyMaterial,
  options: {
    unitIndex: number;
    issuedIsPerUnit: boolean;
    issuedOverride?: number;
  }
) {
  const required = material.quantity ?? material.estimatedQuantity ?? 0;
  const totalIssued = material.quantityIssued ?? 0;
  const issued =
    options.issuedOverride !== undefined
      ? options.issuedOverride
      : options.issuedIsPerUnit
        ? totalIssued
        : required === 0
          ? totalIssued
          : Math.min(
              required,
              Math.max(0, totalIssued - options.unitIndex * required)
            );
  return { required, issued, fullyIssued: required > 0 && issued >= required };
}

export type MaterialState<M> = {
  material: M;
  /** 1-based numbers of the steps this part is assigned to. */
  stepNumbers: number[];
  isTracked: boolean;
  required: number;
  issued: number;
  fullyIssued: boolean;
};

/**
 * The parts for the current step with this unit's issue state — computed once,
 * so the list and the completion gate cannot disagree.
 *
 * An untracked part is auto-issued by the server when its owning step is
 * recorded for a unit: a loose part on the operation's first step, an assigned
 * part on any of its steps. That is mirrored here so the row flips to issued
 * the instant the step is done. A link may carry a per-step share of a split
 * BOM line; the row then shows and flips by that share. Tracked parts are
 * issued by scanning and attributed per line, so they keep whole-line numbers.
 */
export function materialStates<M extends AssemblyMaterial>(args: {
  materials: M[];
  steps: AssemblyStep[];
  stepIndex: number;
  unitIndex: number;
  parentIsTracked: boolean;
}): MaterialState<M>[] {
  const { steps, stepIndex, unitIndex } = args;
  const step = steps[stepIndex] ?? null;
  const firstStep = steps[0];
  const stepNumberById = new Map(steps.map((s, i) => [s.id, i + 1] as const));

  return visibleMaterials(args.materials, step, stepIndex).map((m) => {
    const assigned = m.jobOperationStepIds ?? [];
    const stepNumbers = assigned
      .map((id) => stepNumberById.get(id))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);
    const isTracked = Boolean(
      m.requiresSerialTracking || m.requiresBatchTracking
    );
    const isLoose = !isTracked && stepNumbers.length === 0;
    const issuedIsPerUnit = args.parentIsTracked && isTracked;

    const linkShare =
      !isTracked && step != null
        ? ((m.jobOperationStepQuantities ?? {})[step.id] ?? null)
        : null;
    const perUnit = linkShare ?? m.quantity ?? 0;
    const ownedStepDone = isLoose
      ? firstStep !== undefined && isStepDone(firstStep, unitIndex)
      : linkShare !== null && step != null
        ? isStepDone(step, unitIndex)
        : steps.some(
            (s) => assigned.includes(s.id) && isStepDone(s, unitIndex)
          );
    // The override mirrors a backflush that happens WHEN A STEP IS RECORDED.
    // An operation with no steps has no such moment, so there is nothing to
    // mirror and the real issued total is the only truthful number: without
    // this, a part issued by hand on a step-less operation read "0 of 1"
    // for ever. (Web has that quirk; this is the one place the two differ.)
    const issuedOverride =
      steps.length > 0 && !isTracked && perUnit > 0
        ? ownedStepDone
          ? perUnit
          : 0
        : undefined;
    // Shadow the line quantity with the step's share so the numbers describe
    // this step's portion of a split, not the whole line.
    const effective = linkShare !== null ? { ...m, quantity: perUnit } : m;

    return {
      material: effective,
      stepNumbers,
      isTracked,
      ...issuedForUnit(effective, {
        unitIndex,
        issuedIsPerUnit,
        issuedOverride
      })
    };
  });
}

/**
 * Tracked parts on this step that this unit has not been issued in full.
 *
 * They soft-gate the step: Mark done and Record wait for them, Skip does not.
 * Untracked parts never gate — they are backflushed when the step is recorded
 * — and neither does an unplanned extra, which has no requirement to meet.
 */
export function pendingScans<M>(states: MaterialState<M>[]) {
  return states.filter((s) => s.isTracked && s.required > 0 && !s.fullyIssued);
}

/**
 * Whether the unit on screen should be completed automatically now.
 *
 * Assembly builds one unit at a time: on a multi-quantity operation, the
 * moment every step is recorded for the unit being built, one completed
 * quantity is logged and the screen rolls to the next. It never fires for a
 * unit that is already built — its records still read "done", and paging back
 * to it must not complete it twice. Serial units may be worked in any order,
 * so "already built" is the unit's own marker; everything else builds strictly
 * in order, so it is the index against the completed count.
 */
export function shouldAutoCompleteUnit(args: {
  unitCount: number;
  quantityComplete: number;
  unitIndex: number;
  allStepsRecorded: boolean;
  navigatesByEntity: boolean;
  entity: TrackedUnit | null | undefined;
  operationId: string;
}) {
  if (args.unitCount <= 1) return false;
  if (args.unitCount - args.quantityComplete <= 0) return false;
  if (isUnitBuilt(args)) return false;
  return args.allStepsRecorded;
}

/**
 * Whether a unit is already built at this operation.
 *
 * A serial unit answers for itself — its own completion marker — because
 * serial units may be worked in any order. Everything else builds strictly in
 * order, so a unit is built when its index is below the completed count.
 */
export function isUnitBuilt(args: {
  navigatesByEntity: boolean;
  entity: TrackedUnit | null | undefined;
  unitIndex: number;
  quantityComplete: number;
  operationId: string;
}) {
  return args.navigatesByEntity && args.entity
    ? !isUnitIncompleteForOperation(args.entity, args.operationId)
    : args.unitIndex < args.quantityComplete;
}

/**
 * The furthest unit an operator can page to.
 *
 * A serial parent mints one serial at a time — the next unit's entity is
 * created when the current one completes — so a unit with no entity yet cannot
 * be worked on: scanning tracked parts and completing the unit both need it.
 * Batch and untracked parents page purely by index, so every unit is reachable.
 */
export function maxNavigableUnitIndex<E>(
  units: Unit<E>[],
  navigatesByEntity: boolean
) {
  if (!navigatesByEntity) return Math.max(0, units.length - 1);
  return units.reduce(
    (max, unit) => (unit.entity ? Math.max(max, unit.index) : max),
    0
  );
}

/** The first serial unit still to build here, in axis order, or null. */
export function nextIncompleteUnit<E extends TrackedUnit>(
  units: Unit<E>[],
  operationId: string
): Unit<E> | null {
  return (
    units.find(
      (unit) =>
        unit.entity != null &&
        isUnitIncompleteForOperation(unit.entity, operationId)
    ) ?? null
  );
}

/**
 * Open containment actions that have no Inspection step on this operation yet.
 *
 * Web MES adds a step for each when its assembly view opens. This app cannot
 * yet, so it has to SAY so: an operator must not complete a unit believing
 * there was nothing to sign off.
 */
export function containmentWithoutStep<A extends { id: string }>(
  actions: A[],
  steps: { type?: string | null; nonConformanceActionId?: string | null }[]
): A[] {
  const covered = new Set(
    steps
      .filter(
        (step) =>
          step.type === "Inspection" && step.nonConformanceActionId != null
      )
      .map((step) => step.nonConformanceActionId)
  );
  return actions.filter((action) => !covered.has(action.id));
}

/**
 * Every tracked part of the operation that this unit has not been issued in
 * full — across ALL steps, not only the one on screen.
 *
 * This is the question Complete asks. The per-step scan gate is narrower on
 * purpose (it only holds up the step whose parts are missing); completing the
 * unit is the last chance to notice any of them.
 */
export function unissuedTrackedParts<M extends AssemblyMaterial>(args: {
  materials: M[];
  unitIndex: number;
  parentIsTracked: boolean;
}): M[] {
  return args.materials.filter((material) => {
    const isTracked = Boolean(
      material.requiresSerialTracking || material.requiresBatchTracking
    );
    if (!isTracked) return false;
    const state = issuedForUnit(material, {
      unitIndex: args.unitIndex,
      issuedIsPerUnit: args.parentIsTracked
    });
    return state.required > 0 && !state.fullyIssued;
  });
}

/**
 * How much of a part to offer when the operator opens it to issue: what this
 * unit still needs, and one when it needs nothing more (an extra).
 *
 * Never the job's whole remaining requirement. Assembly issues one unit at a
 * time, and a default of ten on a ten-unit job is how every unit's worth gets
 * charged to the first one.
 */
export function unitRemainingToIssue(state: {
  required: number;
  issued: number;
}) {
  const remaining = state.required - state.issued;
  return remaining > 0 ? remaining : 1;
}
