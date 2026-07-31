import type { KyselyDatabase } from "@carbon/database/client";
import type { Updateable } from "kysely";
import type { JobDatabase } from "../../db";

const INTERRUPTED = "This step was interrupted and did not finish.";

export type StepClaim =
  | { claimed: true; stepRunId: string }
  | { claimed: false };

/** jsonb binds as text, so a JS array is never mistaken for a Postgres array. */
function toJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

const SECRET_KEY =
  /secret|token|password|signature|authorization|apikey|api_key/i;
const MAX_STRING_LENGTH = 4096;
const TRUNCATED = "…(truncated)";

/** Strips anything secret-looking and caps long strings, before it reaches the run log. */
export function redactForLog(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length <= MAX_STRING_LENGTH
      ? value
      : value.slice(0, MAX_STRING_LENGTH) + TRUNCATED;
  }
  if (Array.isArray(value)) return value.map(redactForLog);
  if (value !== null && typeof value === "object") {
    const kept: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      kept[key] = redactForLog(entry);
    }
    return kept;
  }
  return value;
}

/** The unique constraint makes the claim atomic. Losing it means a previous
 * attempt already started this step, so the caller must not act. */
export async function claimStep(
  db: JobDatabase,
  params: {
    runId: string;
    companyId: string;
    nodeId: string;
    nodeType: string;
    itemKey: string;
    sequence: number;
    /** The resolved inputs — the only durable record of what the workflow saw. */
    input?: unknown;
  }
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
  params: {
    stepRunId: string;
    companyId: string;
    status: "Succeeded" | "Failed" | "Skipped";
    statusReason?: string | null;
    error?: string | null;
    output?: unknown;
    branchTaken?: string | null;
    startedAt: string;
  }
): Promise<void> {
  const completedAt = new Date();
  const patch: Updateable<KyselyDatabase["workflowStepRun"]> = {
    status: params.status,
    statusReason: params.statusReason ?? null,
    error: params.error ?? null,
    branchTaken: params.branchTaken ?? null,
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - new Date(params.startedAt).getTime()
  };

  if (params.output !== undefined) patch.output = toJson(params.output);

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
