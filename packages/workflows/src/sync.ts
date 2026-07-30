import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely, Transaction } from "kysely";
import { z } from "zod";
import { WORKFLOW_EVENTS } from "./catalog";
import { nodeSchema, type Origin } from "./definition/schema";

/** One desired workflowTriggerEvent row, before ids/defaults. */
export type DesiredTriggerRow = { eventId: string; origin: Origin };

/** One desired company-level WORKFLOW subscription. */
export type DesiredSubscription = {
  table: string;
  operations: ("INSERT" | "UPDATE" | "DELETE")[];
};

const nodesSchema = z.array(nodeSchema);

/**
 * Derive the workflowTriggerEvent rows a promoted version wants: one row per
 * event id on each trigger node, carrying that node's origin. Duplicate event
 * ids across trigger nodes keep the first node's origin (the table is unique
 * on (workflowId, companyId, eventId)).
 */
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

/**
 * Derive the company's WORKFLOW subscriptions from its subscribed event ids,
 * resolved through each event's catalog match block: one `workflow-<table>`
 * subscription per distinct table, operations set to exactly what those
 * events need. Moments resolve to no table and contribute nothing.
 */
export function deriveWorkflowSubscriptions(
  eventIds: string[]
): DesiredSubscription[] {
  const byTable = new Map<string, Set<"INSERT" | "UPDATE" | "DELETE">>();
  for (const eventId of eventIds) {
    const match = WORKFLOW_EVENTS[eventId]?.match;
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

/**
 * Reconcile the company's `workflow-<table>` eventSystemSubscription rows to
 * what its workflowTriggerEvent rows require. Runs inside the caller's
 * transaction. Removal is by exact (companyId, name, table); a row with the
 * wrong operations is deleted and re-inserted (the table is written
 * delete-then-insert by design — see the foundation migration's RLS comment).
 */
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

/**
 * Rewrite one workflow's workflowTriggerEvent rows and reconcile the
 * company's WORKFLOW subscriptions, in one transaction. Kysely bypasses RLS:
 * the caller authorizes first (phase 7's activation route gates on
 * workflows_update before calling).
 */
export async function syncWorkflowTriggers(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  workflowId: string
): Promise<{ eventIds: string[]; tables: string[] }> {
  return db.transaction().execute(async (trx) => {
    const workflow = await trx
      .selectFrom("workflow")
      .select(["active", "activeVersionId"])
      .where("id", "=", workflowId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    let versionId: string | null = null;
    let desired: DesiredTriggerRow[] = [];
    if (workflow?.active && workflow.activeVersionId) {
      const version = await trx
        .selectFrom("workflowVersion")
        .select(["id", "nodes"])
        .where("id", "=", workflow.activeVersionId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (version) {
        versionId = version.id;
        desired = deriveWorkflowTriggerRows(version.nodes);
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

    const { tables } = await reconcileWorkflowSubscriptions(trx, companyId);
    return { eventIds: desired.map((d) => d.eventId), tables };
  });
}

/**
 * Standalone repair entry: reconcile a company's WORKFLOW subscriptions from
 * its current workflowTriggerEvent rows without touching any workflow.
 */
export async function syncWorkflowSubscriptions(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<{ tables: string[] }> {
  return db
    .transaction()
    .execute(async (trx) => reconcileWorkflowSubscriptions(trx, companyId));
}
