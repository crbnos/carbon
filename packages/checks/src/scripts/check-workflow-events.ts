/**
 * Every event id a live workflow subscribes to must still exist in the generated
 * catalog. Needs a live database: `pnpm --filter @carbon/checks workflow-events`.
 */
import { createWorkflowCatalog } from "@carbon/workflows";
import { Client } from "pg";

async function main() {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error(
      "Set DATABASE_URL (or SUPABASE_DB_URL) to the Postgres connection string."
    );
    process.exit(2);
  }

  const catalog = createWorkflowCatalog();
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const { rows } = await client.query<{
      eventId: string;
      workflowId: string;
      companyId: string;
    }>(
      `SELECT DISTINCT t."eventId", t."workflowId", t."companyId"
         FROM "workflowTriggerEvent" t
         JOIN "workflow" w
           ON w."id" = t."workflowId" AND w."companyId" = t."companyId"
        WHERE w."active" = TRUE
        ORDER BY t."eventId"`
    );

    const unknown = rows.filter(
      (row) => catalog.getEvent(row.eventId) === undefined
    );

    for (const row of unknown) {
      console.log(
        `FAIL  workflow ${row.workflowId} (company ${row.companyId}) subscribes to "${row.eventId}", which is not in the catalog.`
      );
    }

    if (unknown.length === 0) {
      console.log(
        `PASS  workflow-events  (${rows.length} subscription(s) all resolve)`
      );
    }
    process.exit(unknown.length > 0 ? 1 : 0);
  } finally {
    await client.end();
  }
}

void main();
