/**
 * Every event id a live workflow subscribes to must still resolve. Needs a live database:
 * `pnpm --filter @carbon/checks workflow-events`. Does NOT run in CI — no job in
 * .github/workflows has database credentials. Run it by hand after a catalog change.
 *
 * Two shapes of drift:
 *  - a shipped id the catalog no longer has (a rename left it behind);
 *  - a custom-field id whose `customField` row is gone. That one the catalog cannot
 *    catch on its own — it PARSES those ids rather than looking them up, deliberately,
 *    so that it stays company-blind. The existence check therefore lives here.
 */
import { createWorkflowCatalog, REGISTRY_ENTRIES } from "@carbon/workflows";
import { Client } from "pg";

const CUSTOM_FIELD_EVENT =
  /^([A-Za-z][A-Za-z0-9]*)\.customFields\.([^.]+)\.changed$/;

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
        WHERE w."publishedVersionId" IS NOT NULL
        ORDER BY t."eventId"`
    );

    // `${companyId}:${table}:${fieldId}` for every custom field that still exists.
    const { rows: fields } = await client.query<{
      id: string;
      table: string;
      companyId: string;
    }>(`SELECT "id", "table", "companyId" FROM "customField"`);
    const known = new Set(
      fields.map((f) => `${f.companyId}:${f.table}:${f.id}`)
    );

    const failures: string[] = [];

    for (const row of rows) {
      if (catalog.getEvent(row.eventId) === undefined) {
        failures.push(
          `FAIL  workflow ${row.workflowId} (company ${row.companyId}) subscribes to "${row.eventId}", which is not in the catalog.`
        );
        continue;
      }

      // The catalog only proves the id is well formed and names a triggerable entity.
      // Whether the field itself still exists is company data, so it is checked here —
      // this is what surfaces a trigger left behind by a deleted custom field.
      const match = CUSTOM_FIELD_EVENT.exec(row.eventId);
      if (match === null) continue;
      const [, entity, fieldId] = match;
      const table =
        entity === undefined ? undefined : REGISTRY_ENTRIES[entity]?.table;
      if (table === undefined || fieldId === undefined) continue;

      if (!known.has(`${row.companyId}:${table}:${fieldId}`)) {
        failures.push(
          `FAIL  workflow ${row.workflowId} (company ${row.companyId}) subscribes to custom field "${fieldId}" on ${table}, which no longer exists in this company.`
        );
      }
    }

    for (const line of failures) console.log(line);

    if (failures.length === 0) {
      console.log(
        `PASS  workflow-events  (${rows.length} subscription(s) all resolve)`
      );
    }
    process.exit(failures.length > 0 ? 1 : 0);
  } finally {
    await client.end();
  }
}

void main();
