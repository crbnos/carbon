import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely, Transaction } from "kysely";
import { z } from "zod";
import { getCatalogEvent } from "./catalog";
import { nextRunAfter } from "./definition/schedule";
import { nodeSchema, type Origin } from "./definition/schema";
import type { Schedule } from "./definition/types";

export type DesiredTriggerRow = { eventId: string; origin: Origin };

export type DesiredSubscription = {
  table: string;
  operations: ("INSERT" | "UPDATE" | "DELETE")[];
};

const nodesSchema = z.array(nodeSchema);

/** The schedule on the version's trigger node, or null if it is event-triggered. */
export function findTriggerSchedule(nodes: unknown): Schedule | null {
  const parsed = nodesSchema.safeParse(nodes);
  if (!parsed.success) {
    throw new Error(
      `workflowVersion nodes failed to parse: ${parsed.error.message}`
    );
  }
  for (const node of parsed.data) {
    if (node.type === "trigger" && node.data.schedule)
      return node.data.schedule;
  }
  return null;
}

/** One row per event id per trigger node; a duplicate event id keeps the first node's origin. */
export function deriveWorkflowTriggerRows(nodes: unknown): DesiredTriggerRow[] {
  const parsed = nodesSchema.safeParse(nodes);
  if (!parsed.success) {
    throw new Error(
      `workflowVersion nodes failed to parse: ${parsed.error.message}`
    );
  }
  const rows = new Map<string, DesiredTriggerRow>();
  for (const node of parsed.data) {
    if (node.type !== "trigger") continue;
    for (const eventId of node.data.events) {
      if (!rows.has(eventId)) {
        rows.set(eventId, { eventId, origin: node.data.origin });
      }
    }
  }
  return [...rows.values()];
}

/** One subscription per distinct table across the event ids; moments have no table. */
export function deriveWorkflowSubscriptions(
  eventIds: string[]
): DesiredSubscription[] {
  const byTable = new Map<string, Set<"INSERT" | "UPDATE" | "DELETE">>();
  for (const eventId of eventIds) {
    // Resolved, not indexed: a custom-field trigger's id is per company and is parsed
    // rather than looked up, and it still needs an UPDATE subscription on its table.
    const match = getCatalogEvent(eventId)?.match;
    if (!match || !("table" in match)) continue;
    const ops = byTable.get(match.table) ?? new Set();
    ops.add(match.operation);
    byTable.set(match.table, ops);
  }
  return [...byTable.entries()]
    .map(([table, ops]) => ({ table, operations: [...ops].sort() }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

function sameOperations(a: string[], b: string[]): boolean {
  return (
    a.length === b.length &&
    [...a].sort().every((op, i) => op === [...b].sort()[i])
  );
}

/** The table has no UPDATE policy, so a row with wrong operations is deleted and re-inserted. */
async function reconcileWorkflowSubscriptions(
  trx: Transaction<KyselyDatabase>,
  companyId: string
): Promise<{ tables: string[] }> {
  const triggerRows = await trx
    .selectFrom("workflowTriggerEvent")
    .select("eventId")
    .where("companyId", "=", companyId)
    .execute();

  const desired = deriveWorkflowSubscriptions(
    triggerRows.map((r) => r.eventId)
  );
  const desiredByName = new Map(desired.map((d) => [`workflow-${d.table}`, d]));

  const existing = await trx
    .selectFrom("eventSystemSubscription")
    .select(["name", "table", "operations"])
    .where("companyId", "=", companyId)
    .where("handlerType", "=", "WORKFLOW")
    .execute();

  for (const sub of existing) {
    const want = desiredByName.get(sub.name);
    if (
      want &&
      want.table === sub.table &&
      sameOperations(sub.operations ?? [], want.operations)
    ) {
      desiredByName.delete(sub.name);
      continue;
    }
    await trx
      .deleteFrom("eventSystemSubscription")
      .where("companyId", "=", companyId)
      .where("name", "=", sub.name)
      .where("table", "=", sub.table)
      .execute();
  }

  for (const [name, d] of desiredByName) {
    await trx
      .insertInto("eventSystemSubscription")
      .values({
        name,
        table: d.table,
        companyId,
        operations: d.operations,
        handlerType: "WORKFLOW",
        config: {},
        filter: {},
        active: true
      })
      .execute();
  }

  return { tables: desired.map((d) => d.table) };
}

/** Kysely bypasses RLS here: the caller must authorize before calling. */
/**
 * Serialises the whole transaction against others for the same company.
 *
 * Required, not optional: this reconciles the company's ENTIRE subscription set
 * inside a per-workflow transaction, so two overlapping publishes each compute
 * their desired set from pre-commit state and one can delete a subscription the
 * other still needs — after which that table stops triggering any workflow, with
 * no error anywhere. The caller owns the lock because `@carbon/workflows` imports
 * Kysely type-only (it is bundled for the browser) and cannot run raw SQL.
 */
export type CompanyLock = (
  trx: Transaction<KyselyDatabase>,
  companyId: string
) => Promise<unknown>;

export async function syncWorkflowTriggers(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  workflowId: string,
  lockCompany: CompanyLock
): Promise<{ eventIds: string[]; tables: string[]; scheduled: boolean }> {
  return db.transaction().execute(async (trx) => {
    // First statement in the transaction — everything below reads company-wide
    // state and must not interleave with another publish or unpublish.
    await lockCompany(trx, companyId);

    const workflow = await trx
      .selectFrom("workflow")
      .select(["publishedVersionId"])
      .where("id", "=", workflowId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    let versionId: string | null = null;
    let desired: DesiredTriggerRow[] = [];
    let schedule: Schedule | null = null;
    // The pointer IS the on/off switch: unpublishing nulls it, so everything below
    // computes an empty desired set and the workflow stops firing.
    if (workflow?.publishedVersionId) {
      const version = await trx
        .selectFrom("workflowVersion")
        .select(["id", "nodes"])
        .where("id", "=", workflow.publishedVersionId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (version) {
        versionId = version.id;
        desired = deriveWorkflowTriggerRows(version.nodes);
        schedule = findTriggerSchedule(version.nodes);
      }
    }

    await trx
      .deleteFrom("workflowTriggerEvent")
      .where("workflowId", "=", workflowId)
      .where("companyId", "=", companyId)
      .execute();

    if (versionId && desired.length > 0) {
      await trx
        .insertInto("workflowTriggerEvent")
        .values(
          desired.map((d) => ({
            companyId,
            workflowId,
            workflowVersionId: versionId as string,
            eventId: d.eventId,
            origin: d.origin
          }))
        )
        .execute();
    }

    // Sole writer of workflow.nextRunAt. Folded in here so a publish or unpublish cannot wire
    // trigger rows and forget the due time — the failure would be silent (workflow never runs).
    const nextRunAt =
      schedule && versionId
        ? nextRunAfter(schedule, workflowId, new Date()).toISOString()
        : null;

    await trx
      .updateTable("workflow")
      .set({ nextRunAt })
      .where("id", "=", workflowId)
      .where("companyId", "=", companyId)
      .execute();

    const { tables } = await reconcileWorkflowSubscriptions(trx, companyId);
    return {
      eventIds: desired.map((d) => d.eventId),
      tables,
      scheduled: nextRunAt !== null
    };
  });
}
