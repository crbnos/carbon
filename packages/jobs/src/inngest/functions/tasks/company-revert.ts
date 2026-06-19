import { chunkArray } from "@carbon/utils";
import { sql } from "kysely";
import { inngest } from "../../client";
import {
  canSetReplicationRole,
  getCompanyTableCatalog,
  getJobDatabaseClient,
  TEMPLATE_INTEGRATION
} from "./company-template";

const DELETE_CHUNK_SIZE = 500;

/**
 * Undo an import run: delete every row the run inserted (tracked in the
 * externalIntegrationMapping ledger), then delete the ledger itself.
 *
 * Ledger entityIds are either a plain id (id-keyed tables) or a JSON-encoded
 * primary key tuple (composite-keyed tables). Deletes run in one transaction
 * in **reverse topological order** (children before parents) so FK
 * constraints are satisfied by construction — the same catalog ordering the
 * import uses to insert, reversed. FK enforcement is also relaxed via
 * `session_replication_role` when the connection allows it.
 */
export const companyRevertFunction = inngest.createFunction(
  {
    id: "company-revert",
    retries: 1,
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/company-revert" },
  async ({ event, step }) => {
    const { companyId, importRunId } = event.data;

    return await step.run("revert-company-import", async () => {
      const db = getJobDatabaseClient(1);

      const ledger = await sql<{ entityType: string; entityId: string }>`
        SELECT ${sql.id("entityType")}, ${sql.id("entityId")}
        FROM ${sql.id("externalIntegrationMapping")}
        WHERE ${sql.id("integration")} = ${TEMPLATE_INTEGRATION}
          AND ${sql.id("companyId")} = ${companyId}
          AND metadata->>'importRunId' = ${importRunId}
      `.execute(db);

      if (ledger.rows.length === 0) {
        console.log("Nothing to revert", { companyId, importRunId });
        return { importRunId, deleted: 0 };
      }

      // Group ledger entries by table, splitting id-keyed (plain id) from
      // composite-keyed (JSON tuple) entityIds.
      const idsByTable = new Map<string, string[]>();
      const tuplesByTable = new Map<string, unknown[][]>();
      for (const row of ledger.rows) {
        if (row.entityId.startsWith("[")) {
          const list = tuplesByTable.get(row.entityType) ?? [];
          list.push(JSON.parse(row.entityId));
          tuplesByTable.set(row.entityType, list);
        } else {
          const list = idsByTable.get(row.entityType) ?? [];
          list.push(row.entityId);
          idsByTable.set(row.entityType, list);
        }
      }

      const catalog = await getCompanyTableCatalog(db);
      const pkColumns = new Map(
        catalog.tables.map((t) => [t.name, t.pkColumns])
      );
      // Reverse topological order: delete children before parents.
      const deleteOrder = catalog.tables
        .map((t) => t.name)
        .reverse()
        .filter((name) => idsByTable.has(name) || tuplesByTable.has(name));

      const replicaMode = await canSetReplicationRole(db);
      let deleted = 0;

      await db.transaction().execute(async (trx) => {
        if (replicaMode) {
          await sql`SET LOCAL session_replication_role = 'replica'`.execute(
            trx
          );
        }

        for (const table of deleteOrder) {
          const ids = idsByTable.get(table);
          if (ids) {
            for (const batch of chunkArray(ids, DELETE_CHUNK_SIZE)) {
              const result = await sql`
                DELETE FROM ${sql.id(table)}
                WHERE ${sql.id("id")} = ANY(${batch})
              `.execute(trx);
              deleted += Number(result.numAffectedRows ?? 0);
            }
          }

          const tuples = tuplesByTable.get(table);
          const columns = pkColumns.get(table);
          if (tuples && columns && columns.length > 0) {
            for (const batch of chunkArray(tuples, DELETE_CHUNK_SIZE)) {
              const result = await sql`
                DELETE FROM ${sql.id(table)}
                WHERE (${sql.join(columns.map((c) => sql.id(c)))}) IN
                  (${sql.join(
                    batch.map(
                      (t) => sql`(${sql.join(t.map((v) => sql`${v}`))})`
                    )
                  )})
              `.execute(trx);
              deleted += Number(result.numAffectedRows ?? 0);
            }
          }
        }

        await sql`
          DELETE FROM ${sql.id("externalIntegrationMapping")}
          WHERE ${sql.id("integration")} = ${TEMPLATE_INTEGRATION}
            AND ${sql.id("companyId")} = ${companyId}
            AND metadata->>'importRunId' = ${importRunId}
        `.execute(trx);
      });

      console.log("Company import reverted", {
        companyId,
        importRunId,
        deleted
      });
      return { importRunId, deleted };
    });
  }
);
