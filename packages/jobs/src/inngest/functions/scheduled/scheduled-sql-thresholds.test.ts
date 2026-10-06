// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));
vi.mock("../../../db", () => ({ getJobDatabaseClient: vi.fn() }));
vi.mock("../../client", () => ({
  inngest: { createFunction: vi.fn(() => ({})) }
}));

import { DIGEST_MIN_AGE_MIN, DIGEST_THRESHOLD } from "./notification-digest";
import {
  COMPACT_DETAIL_DAYS,
  FULL_DETAIL_DAYS,
  RUN_HEADER_DAYS,
  STALE_RUN_HOURS,
  TERMINAL
} from "./workflow-run-retention";

// pg_cron wakes these functions only when `util.*_has_work()` says a run would
// do something, and that SQL repeats the constants above. A constant changed
// on one side only either wakes the function for nothing or leaves work
// undone, so read the newest definition of each and compare.
const MIGRATIONS = new URL(
  "../../../../../database/supabase/migrations/",
  import.meta.url
);

function newestDefinition(fn: string): string {
  const marker = `CREATE OR REPLACE FUNCTION ${fn}(`;
  for (const name of readdirSync(MIGRATIONS).sort().reverse()) {
    const sql = readFileSync(new URL(name, MIGRATIONS), "utf8");
    const start = sql.lastIndexOf(marker);
    if (start === -1) continue;
    const end = sql.indexOf("$$;", start);
    if (end === -1) throw new Error(`${fn} in ${name} has no closing $$;`);
    return sql.slice(start, end);
  }
  throw new Error(`No migration defines ${fn}`);
}

describe("SQL work checks repeat the functions' constants", () => {
  it("util.notification_digest_has_work", () => {
    const sql = newestDefinition("util.notification_digest_has_work");
    expect(sql).toContain(`c.total >= ${DIGEST_THRESHOLD}`);
    expect(sql).toContain(`interval '${DIGEST_MIN_AGE_MIN} minutes'`);
  });

  it("util.workflow_run_retention_has_work", () => {
    const sql = newestDefinition("util.workflow_run_retention_has_work");
    expect(sql).toContain(`interval '${STALE_RUN_HOURS} hours'`);
    expect(sql).toContain(`interval '${FULL_DETAIL_DAYS} days'`);
    expect(sql).toContain(`interval '${COMPACT_DETAIL_DAYS} days'`);
    expect(sql).toContain(`interval '${RUN_HEADER_DAYS} days'`);
    expect(sql).toContain(
      `IN (${TERMINAL.map((status) => `'${status}'`).join(", ")})`
    );
  });
});
