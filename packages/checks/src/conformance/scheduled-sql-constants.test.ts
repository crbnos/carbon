// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  findScheduledSqlDrift,
  SCHEDULED_WORK_CHECKS
} from "./scheduled-sql-constants";

const [digest, retention] = SCHEDULED_WORK_CHECKS as [
  (typeof SCHEDULED_WORK_CHECKS)[number],
  (typeof SCHEDULED_WORK_CHECKS)[number]
];

const sources = (threshold = 5) => [
  {
    file: digest.constants,
    contents: `export const DIGEST_THRESHOLD = ${threshold};\nexport const DIGEST_MIN_AGE_MIN = 60;`
  },
  {
    file: retention.constants,
    contents: `export const STALE_RUN_HOURS = 24;
export const FULL_DETAIL_DAYS = 7;
export const COMPACT_DETAIL_DAYS = 30;
export const RUN_HEADER_DAYS = 90;
export const TERMINAL = ["Succeeded", "Failed"] as const;`
  }
];

const digestSql = (
  total: number
) => `CREATE OR REPLACE FUNCTION util.notification_digest_has_work()
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 WHERE "createdAt" < now() - interval '60 minutes' AND c.total >= ${total})
$$;`;

const retentionSql = `CREATE OR REPLACE FUNCTION util.workflow_run_retention_has_work()
RETURNS boolean AS $$
  SELECT now() - interval '24 hours', interval '7 days', interval '30 days',
    interval '90 days', "status" IN ('Succeeded', 'Failed')
$$;`;

const drift = (migrations: string[], threshold?: number) =>
  findScheduledSqlDrift(
    migrations.map((contents, i) => ({ file: `${i}.sql`, contents })),
    sources(threshold)
  ).map((v) => v.snippet);

describe("findScheduledSqlDrift", () => {
  it("accepts SQL that repeats every constant", () => {
    expect(drift([digestSql(5), retentionSql])).toEqual([]);
  });

  it("flags a constant changed in TypeScript only", () => {
    expect(drift([digestSql(5), retentionSql], 10)).toEqual([
      "util.notification_digest_has_work: c.total >= {DIGEST_THRESHOLD}"
    ]);
  });

  it("reads the newest definition, so a later migration's change counts", () => {
    expect(drift([digestSql(5), retentionSql, digestSql(10)], 10)).toEqual([]);
    expect(drift([digestSql(10), retentionSql, digestSql(5)], 10)).toEqual([
      "util.notification_digest_has_work: c.total >= {DIGEST_THRESHOLD}"
    ]);
  });

  it("flags a function no migration defines", () => {
    expect(drift([retentionSql])).toEqual([
      "util.notification_digest_has_work"
    ]);
  });
});
