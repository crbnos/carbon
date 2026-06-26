import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** An invariant is a SQL query that returns rows which VIOLATE the rule (empty = healthy). */
export type Invariant = { id: string; sql: string };

/** Injected DB access so the runner is testable without a real database. */
export type Query = (sql: string) => Promise<unknown[]>;

export type InvariantResult = {
  id: string;
  passed: boolean;
  violatingRows: unknown[];
  error?: string;
};

export function loadInvariants(dir: string): Invariant[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({
      id: f.replace(/\.sql$/, ""),
      sql: readFileSync(join(dir, f), "utf8")
    }));
}

export async function runInvariants(
  invariants: Invariant[],
  query: Query
): Promise<InvariantResult[]> {
  const results: InvariantResult[] = [];
  for (const inv of invariants) {
    try {
      const rows = await query(inv.sql);
      results.push({
        id: inv.id,
        passed: rows.length === 0,
        violatingRows: rows
      });
    } catch (e) {
      results.push({
        id: inv.id,
        passed: false,
        violatingRows: [],
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }
  return results;
}
