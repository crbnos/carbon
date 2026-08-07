import { datetime } from "@carbon/utils";
import { sql } from "kysely";
import type { JobDatabase } from "../../db";

export interface RunContext {
  run: {
    id: string;
    companyId: string;
    ownerId: string;
    workflowId: string;
    workflowVersionId: string;
    eventId: string;
    status: string;
  };
  workflowActive: boolean;
  /** The company's group, which service functions need. Falls back to the company. */
  companyGroupId: string;
  version: {
    formatVersion: number | null;
    nodes: unknown;
    edges: unknown;
  } | null;
}

/** One read: the run, its workflow's on/off switch, and the version it was queued against. */
export async function loadRunContext(
  db: JobDatabase,
  runId: string,
  companyId: string
): Promise<RunContext | null> {
  const row = await db
    .selectFrom("workflowRun as r")
    .leftJoin("workflow as w", (join) =>
      join
        .onRef("w.id", "=", "r.workflowId")
        .onRef("w.companyId", "=", "r.companyId")
    )
    // Pinned to the run's own workflowVersionId, so a promote mid-flight cannot
    // swap the definition under it.
    .leftJoin("workflowVersion as v", (join) =>
      join
        .onRef("v.id", "=", "r.workflowVersionId")
        .onRef("v.companyId", "=", "r.companyId")
    )
    .leftJoin("company as c", "c.id", "r.companyId")
    .select([
      "r.id as id",
      "r.companyId as companyId",
      "r.ownerId as ownerId",
      "r.workflowId as workflowId",
      "r.workflowVersionId as workflowVersionId",
      "r.eventId as eventId",
      "r.status as status",
      "w.active as workflowActive",
      "c.companyGroupId as companyGroupId",
      "v.formatVersion as formatVersion",
      "v.nodes as nodes",
      "v.edges as edges"
    ])
    .where("r.id", "=", runId)
    .where("r.companyId", "=", companyId)
    .executeTakeFirst();

  if (!row) return null;

  return {
    run: {
      id: row.id,
      companyId: row.companyId,
      ownerId: row.ownerId,
      workflowId: row.workflowId,
      workflowVersionId: row.workflowVersionId,
      eventId: row.eventId,
      status: row.status
    },
    workflowActive: row.workflowActive === true,
    companyGroupId: row.companyGroupId ?? row.companyId,
    version:
      row.nodes === null
        ? null
        : {
            formatVersion: row.formatVersion,
            nodes: row.nodes as unknown,
            edges: row.edges as unknown
          }
  };
}

/** Flips Queued → Running. Returns false when the row was not Queued (a double delivery). */
export async function claimRun(
  db: JobDatabase,
  runId: string,
  companyId: string
): Promise<boolean> {
  const claimed = await db
    .updateTable("workflowRun")
    .set({ status: "Running", startedAt: sql<string>`now()` })
    .where("id", "=", runId)
    .where("companyId", "=", companyId)
    .where("status", "=", "Queued")
    .returning(["id"])
    .executeTakeFirst();

  return claimed !== undefined;
}

/** The crash exit. Queued counts because the function can die before "load"
 * claims it; a run already in a terminal status is left alone. */
export async function failCrashedRun(
  db: JobDatabase,
  runId: string,
  companyId: string,
  error: string
): Promise<void> {
  const row = await db
    .selectFrom("workflowRun")
    .select(["startedAt"])
    .where("id", "=", runId)
    .where("companyId", "=", companyId)
    .where("status", "in", ["Queued", "Running"])
    .executeTakeFirst();

  if (row === undefined) return;

  await finishRun(db, {
    runId,
    companyId,
    status: "Failed",
    error,
    startedAt: row.startedAt ?? datetime.timestamp()
  });
}

export type FinishRunInput = {
  runId: string;
  companyId: string;
  status: "Succeeded" | "Failed" | "Skipped";
  statusReason?: string | null;
  error?: string | null;
  startedAt: string;
};

export async function finishRun(
  db: JobDatabase,
  params: FinishRunInput
): Promise<void> {
  const completedAt = datetime.timestamp();
  const durationMs = Math.max(
    0,
    Date.parse(completedAt) - new Date(params.startedAt).getTime()
  );

  await db
    .updateTable("workflowRun")
    .set({
      status: params.status,
      statusReason: params.statusReason ?? null,
      error: params.error ?? null,
      completedAt,
      durationMs
    })
    .where("id", "=", params.runId)
    .where("companyId", "=", params.companyId)
    .execute();
}
