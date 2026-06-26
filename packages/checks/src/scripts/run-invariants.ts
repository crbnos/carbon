import { join } from "node:path";
import { Client } from "pg";
import { loadInvariants, type Query, runInvariants } from "../invariant";
import { repoRoot } from "../sources/migrations";

async function main() {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error(
      "Set DATABASE_URL (or SUPABASE_DB_URL) to the Postgres connection string."
    );
    process.exit(2);
  }
  const client = new Client({ connectionString });
  await client.connect();
  const query: Query = async (sql) => (await client.query(sql)).rows;
  try {
    const dir = join(repoRoot(), "packages/checks/src/invariants");
    const results = await runInvariants(loadInvariants(dir), query);
    let failed = 0;
    for (const r of results) {
      if (r.passed) {
        console.log(`PASS  ${r.id}`);
      } else {
        failed++;
        console.log(
          `FAIL  ${r.id}  (${r.error ?? `${r.violatingRows.length} violating rows`})`
        );
      }
    }
    console.log(
      `\n${results.length - failed}/${results.length} invariants healthy.`
    );
    process.exit(failed > 0 ? 1 : 0);
  } finally {
    await client.end();
  }
}

void main();
