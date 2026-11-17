// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";

export const timeTypes = ["Setup", "Labor", "Machine"] as const;
export type TimeType = (typeof timeTypes)[number];

/** The most runs `getOperationRuns` returns: the latest ones. */
export const RUN_LIMIT = 2000;

export type TimeOutlier = {
  jobId: string;
  jobReadableId: string;
  seconds: number;
  endedAt: string;
};

/** A box of the plot: seconds per run for Setup, seconds per unit otherwise. */
export type TimeDistribution = {
  key: string;
  label: string;
  count: number;
  excluded: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  /** The latest method version among the group's runs. */
  version: number;
  outliers: TimeOutlier[];
};

/**
 * An item's operations, and the selected operation by method version and by
 * operator. The last two are empty without a selected operation.
 */
export type TimeDistributions = Record<
  "operations" | "versions" | "operators",
  TimeDistribution[]
>;

/** One finished run of an operation, for plotting runs individually. */
export type TimeRun = TimeOutlier & { version: number; outlier: boolean };

type RunFilter = {
  companyId: string;
  itemId: string;
  type: TimeType;
  /** Runs that finished between these two instants. */
  from: string;
  to: string;
  includeOutliers?: boolean;
};

// Fences need enough runs for the quartiles to mean something.
const MIN_RUNS_FOR_FENCES = 5;

/** An operation has no stable id across jobs, so it is its process and description. */
export function operationKey(processId: string, description: string | null) {
  return `${processId}:${description ?? ""}`;
}

function parseOperationKey(key: string) {
  const split = key.indexOf(":");
  return split < 0
    ? { processId: key, description: "" }
    : { processId: key.slice(0, split), description: key.slice(split + 1) };
}

// The driver hands a timestamptz back as a Date; every instant leaves as ISO text.
const isoEndedAt = sql`to_char("endedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * The `scored` CTE: one row per finished run, flagged `outlier` when it falls
 * outside the 1.5 × IQR fences of its operation. A run is one job operation:
 * its clocked time of the given type, per unit completed unless it is setup.
 * `soloEmployeeId` is the one operator every event of the run names, if any.
 * An operation whose middle half of runs is a single value has no fences:
 * with no spread, every other run would be an outlier.
 */
function scoredRuns(args: RunFilter, operation?: string) {
  const perUnit = args.type !== "Setup";
  const only = operation ? parseOperationKey(operation) : null;
  return sql`
    WITH run AS (
      SELECT
        jo."jobId",
        j."jobId" AS "jobReadableId",
        jo."processId",
        coalesce(jo.description, '') AS description,
        jo."order",
        jmm.version::float8 AS version,
        max(pe."endTime") AS "endedAt",
        CASE
          WHEN count(DISTINCT pe."employeeId") = 1 AND count(pe."employeeId") = count(*)
          THEN min(pe."employeeId")
        END AS "soloEmployeeId",
        (sum(pe.duration) / ${perUnit ? sql`jo."quantityComplete"` : sql`1`})::float8 AS seconds
      FROM "jobMakeMethod" jmm
      JOIN "jobOperation" jo ON jo."jobMakeMethodId" = jmm.id
      JOIN "job" j ON j.id = jo."jobId"
      JOIN "productionEvent" pe ON pe."jobOperationId" = jo.id
      WHERE jmm."itemId" = ${args.itemId}
        AND jmm."companyId" = ${args.companyId}
        AND jo.status = 'Done'
        AND jo."reworkId" IS NULL
        AND pe.type = ${args.type}
        AND pe."endTime" IS NOT NULL
        ${perUnit ? sql`AND jo."quantityComplete" > 0` : sql``}
        ${
          only
            ? sql`AND jo."processId" = ${only.processId}
                  AND coalesce(jo.description, '') = ${only.description}`
            : sql``
        }
      GROUP BY jo.id, j."jobId", jmm.version
      HAVING max(pe."endTime") BETWEEN ${args.from}::timestamptz AND ${args.to}::timestamptz
    ),
    fence AS (
      SELECT
        "processId",
        description,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY seconds) AS q1,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY seconds) AS q3
      FROM run
      GROUP BY "processId", description
      HAVING count(*) >= ${MIN_RUNS_FOR_FENCES}
    ),
    scored AS (
      SELECT
        run.*,
        run."processId" || ':' || run.description AS operation,
        coalesce(
          f.q3 > f.q1
            AND run.seconds NOT BETWEEN f.q1 - 1.5 * (f.q3 - f.q1) AND f.q3 + 1.5 * (f.q3 - f.q1),
          false
        ) AS outlier
      FROM run
      LEFT JOIN fence f USING ("processId", description)
    )
  `;
}

/**
 * How long finished runs of an item's operations took, as one distribution per
 * operation and, for the selected `operation`, per method version and per
 * operator, all from one scan. Outliers are listed on their operation and left
 * out of the statistics unless `includeOutliers`. The operator distributions
 * hold only runs one operator worked alone, since a shared run's time cannot
 * be split between them.
 */
export async function getOperationTimeDistributions(
  db: Kysely<KyselyDatabase>,
  args: RunFilter & { operation?: string }
): Promise<TimeDistributions> {
  const keep = args.includeOutliers ? sql`true` : sql`NOT outlier`;
  const selected = args.operation ?? null;

  const { rows } = await sql<
    TimeDistribution & { groupBy: keyof TimeDistributions }
  >`
    ${scoredRuns(args)},
    member AS (
      SELECT s.seconds, s.outlier, s.version, s."jobId", s."jobReadableId", s."endedAt", g.*
      FROM scored s
      JOIN "process" p ON p.id = s."processId"
      LEFT JOIN "user" u ON u.id = s."soloEmployeeId"
      CROSS JOIN LATERAL (VALUES
        ('operations', s.operation, coalesce(nullif(s.description, ''), p.name), s."order"::float8, true),
        ('versions', s.version::text, 'V' || s.version, s.version, s.operation = ${selected}),
        (
          'operators',
          s."soloEmployeeId",
          coalesce(u."fullName", s."soloEmployeeId"),
          0,
          s.operation = ${selected} AND s."soloEmployeeId" IS NOT NULL
        )
      ) AS g("groupBy", key, label, position, member)
      WHERE g.member
    )
    SELECT
      "groupBy",
      key,
      label,
      (count(*) FILTER (WHERE ${keep}))::int AS count,
      (count(*) FILTER (WHERE outlier AND NOT (${keep})))::int AS excluded,
      min(seconds) FILTER (WHERE ${keep}) AS min,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY seconds) FILTER (WHERE ${keep}) AS q1,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) FILTER (WHERE ${keep}) AS median,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY seconds) FILTER (WHERE ${keep}) AS q3,
      max(seconds) FILTER (WHERE ${keep}) AS max,
      avg(seconds) FILTER (WHERE ${keep}) AS mean,
      max(version) AS version,
      coalesce(
        json_agg(
          json_build_object(
            'jobId', "jobId",
            'jobReadableId', "jobReadableId",
            'seconds', seconds,
            'endedAt', ${isoEndedAt}
          )
          ORDER BY seconds DESC
        ) FILTER (WHERE outlier AND "groupBy" = 'operations'),
        '[]'
      ) AS outliers
    FROM member
    GROUP BY "groupBy", key, label
    HAVING count(*) FILTER (WHERE ${keep}) > 0
    ORDER BY "groupBy", min(position), label
  `.execute(db);

  const groups: TimeDistributions = {
    operations: [],
    versions: [],
    operators: []
  };
  for (const { groupBy, ...row } of rows) groups[groupBy].push(row);
  return groups;
}

/**
 * The latest `RUN_LIMIT` runs of one operation, oldest first, without the
 * outliers unless asked for.
 */
export async function getOperationRuns(
  db: Kysely<KyselyDatabase>,
  args: RunFilter & { operation: string }
): Promise<TimeRun[]> {
  const { rows } = await sql<TimeRun>`
    ${scoredRuns(args, args.operation)},
    latest AS (
      SELECT "jobId", "jobReadableId", seconds, "endedAt", version, outlier
      FROM scored
      ${args.includeOutliers ? sql`` : sql`WHERE NOT outlier`}
      ORDER BY "endedAt" DESC
      LIMIT ${RUN_LIMIT}
    )
    SELECT "jobId", "jobReadableId", seconds, ${isoEndedAt} AS "endedAt", version, outlier
    FROM latest
    ORDER BY latest."endedAt"
  `.execute(db);
  return rows;
}
