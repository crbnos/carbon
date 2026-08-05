import type { KyselyDatabase } from "@carbon/database/client";
import type { Updateable } from "kysely";
import type { JobDatabase } from "../../db";
import type { FinishRunInput } from "./log";

const INTERRUPTED = "This step was interrupted and did not finish.";

export type StepClaim =
  | { claimed: true; stepRunId: string }
  | { claimed: false };

/** jsonb binds as text, so a JS array is never mistaken for a Postgres array. */
function toJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

// Deliberately excludes bare `key`, `auth` and `session`: `itemKey` is a column of
// this table and `authorizedBy` is ordinary ERP data. Over-redaction in a debugging
// tool is a failure too.
const SECRET_KEY =
  /secret|token|password|passwd|credential|signature|authorization|apikey|api_key|client_secret|clientsecret|private_key|privatekey|bearer|cookie/i;
const MAX_STRING_LENGTH = 4096;
const REDACTED = "[REDACTED]";

/** Both the definition and runtime `pairs` shapes: same discriminator, same entry shape. */
function isPairsShape(
  value: object
): value is { kind: "pairs"; entries: unknown[] } {
  return (
    (value as { kind?: unknown }).kind === "pairs" &&
    Array.isArray((value as { entries?: unknown }).entries)
  );
}

/** Replaces anything secret-looking and caps long strings, before it reaches the
 * run log. The key is kept and its value replaced: a dropped key is
 * indistinguishable from a field that was genuinely absent, and telling those two
 * apart is the whole job of a run log. */
export function redactForLog(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value;
    const dropped = value.length - MAX_STRING_LENGTH;
    return `${value.slice(0, MAX_STRING_LENGTH)}… ${dropped} more characters`;
  }
  if (Array.isArray(value)) return value.map(redactForLog);
  if (value !== null && typeof value === "object") {
    // Rows carry secrets in the value, not the key, and a name like `X-Company-Key`
    // matches no pattern. Mask by shape so no header name can escape it.
    if (isPairsShape(value)) {
      return {
        ...value,
        entries: value.entries.map((entry) => ({
          name: (entry as { name?: unknown } | null)?.name,
          value: REDACTED
        }))
      };
    }
    const kept: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      kept[key] = SECRET_KEY.test(key) ? REDACTED : redactForLog(entry);
    }
    return kept;
  }
  return value;
}

/** For the free-text columns. Only truncation applies to a bare string — key-name
 * redaction needs keys — but an unbounded error message is worth capping. */
export function redactText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return redactForLog(value) as string;
}

export type ClaimStepInput = {
  runId: string;
  companyId: string;
  nodeId: string;
  nodeType: string;
  itemKey: string;
  sequence: number;
  /** The step's configuration, written before it acts. The values it actually
   * resolved arrive later, via `settleStep`. */
  input?: unknown;
};

export type SettleStepInput = {
  stepRunId: string;
  companyId: string;
  status: "Succeeded" | "Failed" | "Skipped";
  statusReason?: string | null;
  error?: string | null;
  output?: unknown;
  input?: unknown;
  detail?: unknown;
  branchTaken?: string | null;
  startedAt: string;
};

/** The unique constraint makes the claim atomic. Losing it means a previous
 * attempt already started this step, so the caller must not act. */
export async function claimStep(
  db: JobDatabase,
  params: ClaimStepInput
): Promise<StepClaim> {
  const inserted = await db
    .insertInto("workflowStepRun")
    .values({
      companyId: params.companyId,
      runId: params.runId,
      nodeId: params.nodeId,
      nodeType: params.nodeType,
      itemKey: params.itemKey,
      sequence: params.sequence,
      status: "Running",
      startedAt: new Date().toISOString(),
      input:
        params.input === undefined ? null : toJson(redactForLog(params.input))
    })
    .onConflict((oc) =>
      oc.constraint("workflowStepRun_idempotency_key").doNothing()
    )
    .returning(["id"])
    .executeTakeFirst();

  return inserted
    ? { claimed: true, stepRunId: inserted.id }
    : { claimed: false };
}

/** Closes a claimed step. `statusReason` carries a skip, `error` a failure. */
export async function settleStep(
  db: JobDatabase,
  params: SettleStepInput
): Promise<void> {
  const completedAt = new Date();
  const patch: Updateable<KyselyDatabase["workflowStepRun"]> = {
    status: params.status,
    statusReason: redactText(params.statusReason),
    error: redactText(params.error),
    branchTaken: params.branchTaken ?? null,
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - new Date(params.startedAt).getTime()
  };

  if (params.input !== undefined)
    patch.input = toJson(redactForLog(params.input));
  if (params.output !== undefined)
    patch.output = toJson(redactForLog(params.output));
  if (params.detail !== undefined) patch.detail = toJson(params.detail);

  await db
    .updateTable("workflowStepRun")
    .set(patch)
    .where("id", "=", params.stepRunId)
    .where("companyId", "=", params.companyId)
    .execute();
}

/** Marks rows this run left mid-flight, so a lost action is visible rather than silent. */
export async function failInterruptedSteps(
  db: JobDatabase,
  runId: string,
  companyId: string
): Promise<number> {
  const result = await db
    .updateTable("workflowStepRun")
    .set({
      status: "Failed",
      error: INTERRUPTED,
      completedAt: new Date().toISOString()
    })
    .where("runId", "=", runId)
    .where("companyId", "=", companyId)
    .where("status", "=", "Running")
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0);
}

/** One in-memory step record, shaped for the columns the run-detail UI renders. */
export type StepRecord = {
  sequence: number;
  nodeId: string;
  nodeType: string;
  itemKey: string;
  status: string;
  statusReason: string | null;
  error: string | null;
  input: unknown;
  output: unknown;
  detail: unknown;
  branchTaken: string | null;
  durationMs: number | null;
};

/** Where a run's steps and final status go. The durable one writes the two run-log
 * tables; the memory one keeps them for a manual test run and writes nothing. */
export interface RunLedger {
  claimStep(
    input: Omit<ClaimStepInput, "runId" | "companyId">
  ): Promise<StepClaim>;
  settleStep(input: Omit<SettleStepInput, "companyId">): Promise<void>;
  failInterruptedSteps(): Promise<number>;
  finishRun(input: Omit<FinishRunInput, "runId" | "companyId">): Promise<void>;
  /** Empty for the durable ledger; the collected rows for the memory one. */
  records(): StepRecord[];
}

/** Holds a run's steps in memory for a manual test run. Nothing is written, but the
 * same redaction applies — a test run displays webhook headers and action inputs. */
export function createMemoryLedger(): RunLedger {
  const records: StepRecord[] = [];
  const byId = new Map<string, StepRecord>();
  let next = 0;

  return {
    claimStep: async (input) => {
      const stepRunId = String(++next);
      const record: StepRecord = {
        sequence: input.sequence,
        nodeId: input.nodeId,
        nodeType: input.nodeType,
        itemKey: input.itemKey,
        status: "Running",
        statusReason: null,
        error: null,
        input: input.input === undefined ? null : redactForLog(input.input),
        output: null,
        detail: null,
        branchTaken: null,
        durationMs: null
      };
      records.push(record);
      byId.set(stepRunId, record);
      return { claimed: true, stepRunId };
    },
    settleStep: async (input) => {
      const record = byId.get(input.stepRunId);
      if (record === undefined) return;
      record.status = input.status;
      record.statusReason = redactText(input.statusReason);
      record.error = redactText(input.error);
      record.branchTaken = input.branchTaken ?? null;
      record.durationMs = Math.max(
        0,
        Date.now() - new Date(input.startedAt).getTime()
      );
      if (input.input !== undefined) record.input = redactForLog(input.input);
      if (input.output !== undefined)
        record.output = redactForLog(input.output);
      if (input.detail !== undefined) record.detail = input.detail;
    },
    failInterruptedSteps: async () => {
      let changed = 0;
      for (const record of records) {
        if (record.status !== "Running") continue;
        record.status = "Failed";
        record.error = INTERRUPTED;
        changed += 1;
      }
      return changed;
    },
    // Nothing to close: there is no `workflowRun` row for a manual test run.
    finishRun: async () => {
      return;
    },
    records: () => records
  };
}
