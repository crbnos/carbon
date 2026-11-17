// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";

export const timeTypes = ["Setup", "Labor", "Machine"] as const;
export const timeGroupings = ["operation", "operator", "version"] as const;

export type TimeType = (typeof timeTypes)[number];
export type TimeGrouping = (typeof timeGroupings)[number];

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

/** One finished run of an operation, for plotting runs individually. */
export type TimeRun = {
  jobId: string;
  jobReadableId: string;
  seconds: number;
  endedAt: string;
  version: number;
  outlier: boolean;
};

type RunFilter = {
  companyId: string;
  itemId: string;
  type: TimeType;
  /** Runs that finished between these two instants. */
  from: string;
  to: string;
  operation?: string;
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
  return { processId: key.slice(0, split), description: key.slice(split + 1) };
}

/**
 * The `scored` CTE: one row per finished run, flagged `outlier` when it falls
 * outside the 1.5 × IQR fences of its operation.
 */
function scoredRuns(args: RunFilter, soloOnly = false) {
  const perUnit = args.type !== "Setup";
  const operation = args.operation ? parseOperationKey(args.operation) : null;
  return sql`
    WITH run AS (
      SELECT
        jo."jobId",
        j."jobId" AS "jobReadableId",
        jo."processId",
        coalesce(jo.description, '') AS description,
        jo."order",
        jmm.version,
        max(pe."endTime") AS "endedAt",
        count(DISTINCT pe."employeeId") AS operators,
        min(pe."employeeId") AS "employeeId",
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
          operation
            ? sql`AND jo."processId" = ${operation.processId}
                  AND coalesce(jo.description, '') = ${operation.description}`
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
        coalesce(
          run.seconds NOT BETWEEN f.q1 - 1.5 * (f.q3 - f.q1) AND f.q3 + 1.5 * (f.q3 - f.q1),
          false
        ) AS outlier
      FROM run
      LEFT JOIN fence f USING ("processId", description)
      ${soloOnly ? sql`WHERE run.operators = 1` : sql``}
    )
  `;
}

/**
 * How long finished runs of an item's operations took, as one distribution per
 * group. A run is one job operation: its clocked time of the given type, per
 * unit completed unless it is setup. Runs outside the 1.5 × IQR fences of their
 * operation are reported as `outliers` and left out of the statistics unless
 * `includeOutliers`. Grouping by operator keeps only runs one operator worked
 * alone, since a shared run's time cannot be split between them.
 */
export async function getOperationTimeDistributions(
  db: Kysely<KyselyDatabase>,
  args: RunFilter & { groupBy: TimeGrouping }
): Promise<TimeDistribution[]> {
  const keep = args.includeOutliers ? sql`true` : sql`NOT s.outlier`;

  const group = {
    operation: {
      key: sql`s."processId" || ':' || s.description`,
      label: sql`coalesce(nullif(s.description, ''), p.name)`,
      join: sql`JOIN "process" p ON p.id = s."processId"`,
      order: sql`min(s."order")`
    },
    operator: {
      key: sql`s."employeeId"`,
      label: sql`coalesce(u."fullName", s."employeeId")`,
      join: sql`LEFT JOIN "user" u ON u.id = s."employeeId"`,
      order: sql`2`
    },
    version: {
      key: sql`s.version::text`,
      label: sql`'V' || s.version::float8`,
      join: sql``,
      order: sql`min(s.version)`
    }
  }[args.groupBy];

  const { rows } = await sql<TimeDistribution>`
    ${scoredRuns(args, args.groupBy === "operator")}
    SELECT
      ${group.key} AS key,
      ${group.label} AS label,
      (count(*) FILTER (WHERE ${keep}))::int AS count,
      (count(*) FILTER (WHERE s.outlier AND NOT (${keep})))::int AS excluded,
      min(s.seconds) FILTER (WHERE ${keep}) AS min,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY s.seconds) FILTER (WHERE ${keep}) AS q1,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY s.seconds) FILTER (WHERE ${keep}) AS median,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY s.seconds) FILTER (WHERE ${keep}) AS q3,
      max(s.seconds) FILTER (WHERE ${keep}) AS max,
      avg(s.seconds) FILTER (WHERE ${keep}) AS mean,
      max(s.version)::float8 AS version,
      coalesce(
        json_agg(
          json_build_object(
            'jobId', s."jobId",
            'jobReadableId', s."jobReadableId",
            'seconds', s.seconds,
            'endedAt', s."endedAt"
          )
          ORDER BY s.seconds DESC
        ) FILTER (WHERE s.outlier),
        '[]'
      ) AS outliers
    FROM scored s
    ${group.join}
    GROUP BY 1, 2
    HAVING count(*) FILTER (WHERE ${keep}) > 0
    ORDER BY ${group.order}
  `.execute(db);

  return rows;
}

/** The runs of one operation, oldest first, without the outliers unless asked for. */
export async function getOperationRuns(
  db: Kysely<KyselyDatabase>,
  args: RunFilter & { operation: string }
): Promise<TimeRun[]> {
  const { rows } = await sql<TimeRun>`
    ${scoredRuns(args)}
    SELECT "jobId", "jobReadableId", seconds, "endedAt", version::float8 AS version, outlier
    FROM scored
    ${args.includeOutliers ? sql`` : sql`WHERE NOT outlier`}
    ORDER BY "endedAt"
    LIMIT 2000
  `.execute(db);
  return rows;
}
