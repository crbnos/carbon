// Pure posting plan for a cut list confirmation. No imports, no DB, no Deno
// APIs — same discipline as batch-split.ts and resolve-tracked-entity-bin.ts,
// so `deno test` type-checks it cleanly and the logic is testable without a
// database.
//
// Cut lists build ON Job Operation Batching (issue #1010). Two concerns that
// used to live here are the batch's, not the cut list's, and have been removed:
//   • operation completion — closing each served operation. The batch owns
//     membership (jobOperation.jobOperationBatchId) and completion.
//   • the run's setup + machine time split across served operations. The batch's
//     `complete` splits time from the timers that ran while it was active.
// Both now go through `batch-operations` `complete`; this plan keeps only the
// genuine cut-list layer: line-quantity clamping, `allocations` (material split),
// remnants/scrap, status, actualYieldPct. See
// .ai/plans/2026-08-11-cut-lists-on-operation-batching.md, Task 2.
//
// What a confirmation has to get right:
//   1. One saw run serves many jobs. The stock consumed must be split across
//      those jobs in proportion to the material each one actually took, or the
//      cost strands on the run and never reaches the job (the documented
//      failure mode in every job-batching ERP thread).
//   2. A drop that goes back on the rack is a new lot descended from the bar it
//      came off — it keeps the heat number, or the traceability chain breaks at
//      the first cut.
//   3. A drop shorter than the minimum is scrap, not inventory. Racking a 2"
//      offcut nobody will pick is how remnant tracking loses credibility.

export type ConfirmLineInput = {
  cutListLineId: string;
  quantityCut: number;
};

export type ConfirmLineRow = {
  id: string;
  jobId: string | null;
  itemId: string;
  pieceLength: number;
  quantity: number;
  quantityCut: number;
};

export type ConsumedInput = {
  trackedEntityId: string;
  quantityConsumed: number;
};

export type RemnantInput = {
  fromTrackedEntityId: string;
  length: number;
  storageUnitId?: string;
};

export type ScrapInput = {
  fromTrackedEntityId?: string;
  itemId?: string;
  quantity: number;
  scrapReasonId?: string;
};

export type JobAllocation = {
  /** null when the piece was cut to stock rather than for a job */
  jobId: string | null;
  itemId: string;
  /** share of the consumed quantity attributed to this job */
  quantity: number;
  /** material length this job took, the basis for the share */
  nestedLength: number;
};

export type CutListPostingPlan = {
  /** per-line quantityCut after this confirmation */
  lineUpdates: { id: string; quantityCut: number }[];
  /** consumption split across the jobs the run served */
  allocations: JobAllocation[];
  /** drops long enough to return to stock */
  remnants: RemnantInput[];
  /** drops too short to keep, plus any explicit scrap */
  scrap: ScrapInput[];
  /** Completed once every line is fully cut; otherwise the run stays open */
  status: "In Progress" | "Completed";
  /** used length / consumed length, as a percentage */
  actualYieldPct: number;
  totalConsumed: number;
};

export type BuildPlanArgs = {
  lines: ConfirmLineRow[];
  inputs: ConfirmLineInput[];
  consumed: ConsumedInput[];
  remnants: RemnantInput[];
  scrap: ScrapInput[];
  minRemnantLength: number;
  /** physical length of each consumed lot, keyed by tracked entity id */
  stockLengthByEntity?: Record<string, number>;
};

export function buildCutListPostingPlan(
  args: BuildPlanArgs
): CutListPostingPlan {
  const {
    lines,
    inputs,
    consumed,
    remnants,
    scrap,
    minRemnantLength,
    stockLengthByEntity = {}
  } = args;

  const lineById = new Map(lines.map((line) => [line.id, line]));

  // Apply the operator's counts, clamped to what the line still owes. Cutting
  // more than was asked for is a data-entry slip, not a new requirement.
  const lineUpdates: { id: string; quantityCut: number }[] = [];
  const cutThisRun: { line: ConfirmLineRow; quantity: number }[] = [];

  for (const input of inputs) {
    const line = lineById.get(input.cutListLineId);
    if (!line) {
      throw new Error(`Unknown cut list line: ${input.cutListLineId}`);
    }
    if (input.quantityCut < 0) {
      throw new Error(
        `Quantity cut cannot be negative (line ${input.cutListLineId})`
      );
    }
    const remaining = Math.max(line.quantity - line.quantityCut, 0);
    const applied = Math.min(input.quantityCut, remaining);
    if (applied > 0) {
      cutThisRun.push({ line, quantity: applied });
    }
    lineUpdates.push({
      id: line.id,
      quantityCut: line.quantityCut + applied
    });
  }

  const totalConsumed = consumed.reduce(
    (sum, entry) => sum + entry.quantityConsumed,
    0
  );

  // Split consumption by nested length: a job that took 40 inches of the bar
  // carries twice the cost of one that took 20.
  const lengthByJob = new Map<string, { jobId: string | null; itemId: string; length: number }>();
  let totalNestedLength = 0;

  for (const entry of cutThisRun) {
    const length = entry.line.pieceLength * entry.quantity;
    totalNestedLength += length;
    const key = `${entry.line.jobId ?? ""}::${entry.line.itemId}`;
    const existing = lengthByJob.get(key);
    if (existing) {
      existing.length += length;
    } else {
      lengthByJob.set(key, {
        jobId: entry.line.jobId,
        itemId: entry.line.itemId,
        length
      });
    }
  }

  const allocations: JobAllocation[] = [];
  if (totalNestedLength > 0 && totalConsumed > 0) {
    const entries = [...lengthByJob.values()];
    let allocated = 0;
    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1;
      // The last share absorbs rounding so the allocations always sum to
      // exactly what was consumed — no stranded fractional cost.
      const share = isLast
        ? totalConsumed - allocated
        : roundTo(
            (entry.length / totalNestedLength) * totalConsumed,
            6
          );
      allocated += share;
      allocations.push({
        jobId: entry.jobId,
        itemId: entry.itemId,
        quantity: share,
        nestedLength: entry.length
      });
    });
  }

  // Sort a drop into "back on the rack" or "scrap" by the run's threshold.
  const keptRemnants: RemnantInput[] = [];
  const derivedScrap: ScrapInput[] = [...scrap];

  for (const remnant of remnants) {
    if (remnant.length <= 0) continue;
    if (minRemnantLength > 0 && remnant.length < minRemnantLength) {
      derivedScrap.push({
        fromTrackedEntityId: remnant.fromTrackedEntityId,
        quantity: remnant.length
      });
    } else {
      keptRemnants.push(remnant);
    }
  }

  // Every line fully cut → the run is done. A partial confirmation leaves it
  // open so the operator can come back to it.
  const finalByLine = new Map(lineUpdates.map((u) => [u.id, u.quantityCut]));
  const isComplete = lines.every((line) => {
    const finalCut = finalByLine.get(line.id) ?? line.quantityCut;
    return finalCut >= line.quantity;
  });

  // Yield counts only what was truly used up: a returned drop is still stock.
  const consumedLength = consumed.reduce((sum, entry) => {
    const stockLength = stockLengthByEntity[entry.trackedEntityId];
    return sum + (stockLength ?? 0);
  }, 0);
  const returnedLength = keptRemnants.reduce(
    (sum, remnant) => sum + remnant.length,
    0
  );
  const netConsumedLength = consumedLength - returnedLength;
  const actualYieldPct =
    netConsumedLength > 0
      ? roundTo((totalNestedLength / netConsumedLength) * 100, 2)
      : 0;

  return {
    lineUpdates,
    allocations,
    remnants: keptRemnants,
    scrap: derivedScrap,
    status: isComplete ? "Completed" : "In Progress",
    actualYieldPct,
    totalConsumed
  };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Attributes stamped on a remnant lot. The heat number rides along from the
 * parent so a part cut from a drop still traces to its mill certificate.
 */
export function buildRemnantAttributes(args: {
  length: number;
  unitOfDimension: string;
  parentAttributes: Record<string, unknown> | null;
  cutListReadableId: string;
}): Record<string, unknown> {
  const parent = args.parentAttributes ?? {};
  const heatNumber = parent["Heat Number"];

  return {
    Remnant: true,
    Length: args.length,
    Unit: args.unitOfDimension,
    "Cut List": args.cutListReadableId,
    ...(heatNumber !== undefined ? { "Heat Number": heatNumber } : {})
  };
}
