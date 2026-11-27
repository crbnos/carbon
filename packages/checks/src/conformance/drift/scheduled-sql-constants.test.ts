// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { SCHEDULED_WORK_CHECKS } from "../../sources/cross-file";
import { scheduledSqlConstants } from "./scheduled-sql-constants";

const constantsOf = (fn: string) =>
  SCHEDULED_WORK_CHECKS.find((check) => check.fn === fn)?.constants ?? "";

const scheduledSources = (threshold = 5) => [
  {
    file: constantsOf("util.notification_digest_has_work"),
    contents: `export const DIGEST_THRESHOLD = ${threshold};\nexport const DIGEST_MIN_AGE_MIN = 60;`
  },
  {
    file: constantsOf("util.workflow_run_retention_has_work"),
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

const scheduledSqlDrift = (migrations: string[], threshold?: number) =>
  scheduledSqlConstants
    .find({
      migrations: migrations.map((contents, i) => ({
        file: `${i}.sql`,
        contents
      })),
      constants: scheduledSources(threshold)
    })
    .map((v) => v.snippet);

describe("scheduledSqlConstants", () => {
  it("accepts SQL that repeats every constant", () => {
    expect(scheduledSqlDrift([digestSql(5), retentionSql])).toEqual([]);
  });

  it("flags a constant changed in TypeScript only", () => {
    expect(scheduledSqlDrift([digestSql(5), retentionSql], 10)).toEqual([
      "util.notification_digest_has_work: c.total >= {DIGEST_THRESHOLD}"
    ]);
  });

  it("reads the newest definition, so a later migration's change counts", () => {
    expect(
      scheduledSqlDrift([digestSql(5), retentionSql, digestSql(10)], 10)
    ).toEqual([]);
    expect(
      scheduledSqlDrift([digestSql(10), retentionSql, digestSql(5)], 10)
    ).toEqual([
      "util.notification_digest_has_work: c.total >= {DIGEST_THRESHOLD}"
    ]);
  });

  it("flags a function no migration defines", () => {
    expect(scheduledSqlDrift([retentionSql])).toEqual([
      "util.notification_digest_has_work"
    ]);
  });
});
