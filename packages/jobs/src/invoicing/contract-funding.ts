// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The FAR 52.232-20/-22 funding notices of project billing lines, once a day
// from the recurring billing job. A notice goes out once per threshold per
// funded cost: the line stores the funded cost each notice went out for, so a
// funding change starts a new cycle.
// Plan: .ai/plans/2026-10-09-project-billing-phase-4a.md (Task 13, P12–P14).

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  estimateAtCompletion,
  formatDate,
  formatMoney,
  formatPercent,
  fundingNotice,
  sumSubtree
} from "@carbon/utils";
import { sql } from "kysely";

const LOCALE = "en-US";
const DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

export type FundingLine = {
  id: string;
  customerContractId: string;
  /** The contract's readable id (CON-…). */
  contractReadableId: string;
  /** The line's position on its contract, from 1. */
  lineNumber: number;
  fundedCost: number;
  noticePercent: number;
  noticeWindowDays: number;
  thresholdNoticeFundedCost: number | null;
  runOutNoticeFundedCost: number | null;
  salesPersonId: string | null;
  projectOwnerId: string | null;
  createdBy: string;
};

export type FundingPosition = { incurred: number; recentCost: number };

/** Plan, committed and actual of the line's billing element subtree, and
 *  the element's own estimate at completion when one is set. */
export type SubtreeCost = {
  plan: number;
  committed: number;
  actual: number;
  override: number | null;
};

export type FundingNotice = {
  customerContractId: string;
  customerContractLineId: string;
  kind: "threshold" | "runOut";
  fundedCost: number;
  title: string;
  body: string;
  /** Empty when nobody can be notified; the job skips it. */
  userIds: string[];
};

/** Who hears about a line: its contract's sales person and the project
 *  owner, else the contract's creator unless it is `system`. */
function recipientsOf(line: FundingLine): string[] {
  const owners = [
    ...new Set(
      [line.salesPersonId, line.projectOwnerId].filter(
        (id): id is string => !!id && id !== "system"
      )
    )
  ];
  if (owners.length > 0) return owners;
  return line.createdBy && line.createdBy !== "system" ? [line.createdBy] : [];
}

/**
 * The notices due on `asOf`, one per line and threshold. Pure: the figures
 * come from `checkContractFunding`.
 */
export function buildFundingNotices(
  lines: FundingLine[],
  funding: Map<string, FundingPosition>,
  costs: Map<string, SubtreeCost>,
  asOf: string,
  currency: { code: string; decimalPlaces: number }
): FundingNotice[] {
  const money = (value: number) =>
    formatMoney(value, LOCALE, currency.code, currency.decimalPlaces);
  const notices: FundingNotice[] = [];

  for (const line of lines) {
    const position = funding.get(line.id) ?? { incurred: 0, recentCost: 0 };
    const cost = costs.get(line.id) ?? {
      plan: 0,
      committed: 0,
      actual: 0,
      override: null
    };
    const eac = estimateAtCompletion(cost);
    // The plan caps the expected cost only when the subtree has one (P14).
    const remainingPlan =
      cost.plan > 0 || cost.override !== null
        ? Math.max(eac - position.incurred, 0)
        : null;

    const result = fundingNotice({
      asOf,
      incurred: position.incurred,
      recentCost: position.recentCost,
      remainingPlan,
      fundedCost: line.fundedCost,
      noticePercent: line.noticePercent,
      noticeWindowDays: line.noticeWindowDays,
      thresholdNoticeFundedCost: line.thresholdNoticeFundedCost,
      runOutNoticeFundedCost: line.runOutNoticeFundedCost
    });
    if (!result.threshold && !result.runOut) continue;

    const label = `${line.contractReadableId} line ${line.lineNumber}`;
    const body = [
      `Funded cost ${money(line.fundedCost)}`,
      `incurred ${money(position.incurred)}`,
      `expected in the next ${line.noticeWindowDays} days ${money(result.expected)}`,
      `estimate at completion ${money(eac)}`,
      result.runOutDate
        ? `funds run out by ${formatDate(result.runOutDate, DATE_FORMAT, LOCALE)}`
        : "no run-out date (no cost in the last 90 days)"
    ].join(" · ");
    const shared = {
      customerContractId: line.customerContractId,
      customerContractLineId: line.id,
      fundedCost: line.fundedCost,
      body,
      userIds: recipientsOf(line)
    };

    if (result.threshold) {
      notices.push({
        ...shared,
        kind: "threshold",
        title: `${label}: ${formatPercent(line.noticePercent, LOCALE)} of funded cost`
      });
    }
    if (result.runOut && result.runOutDate) {
      notices.push({
        ...shared,
        kind: "runOut",
        title: `${label}: funds run out by ${formatDate(result.runOutDate, DATE_FORMAT, LOCALE)}`
      });
    }
  }
  return notices;
}

/**
 * Reads every live billing line with a funded cost, its funding position and
 * its subtree's plan, builds the notices due on `asOf`, and stamps each line
 * with the funded cost its notice went out for. A notice with no recipient is
 * returned but not stamped, so it goes out once someone can receive it.
 */
export async function checkContractFunding(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; asOf: string }
): Promise<FundingNotice[]> {
  const { companyId, asOf } = args;

  // 1. The live billing lines with a funded cost (P8, on `asOf`).
  const { rows: lineRows } = await sql<
    FundingLine & { projectId: string; projectElementId: string }
  >`
    SELECT * FROM (
      SELECT l."id", l."customerContractId",
             c."customerContractId" AS "contractReadableId",
             ROW_NUMBER() OVER (
               PARTITION BY l."customerContractId"
               ORDER BY l."sortOrder", l."createdAt", l."id"
             )::int AS "lineNumber",
             l."billingMethod", l."startDate", l."endDate",
             l."fundedCost", l."noticePercent", l."noticeWindowDays",
             l."thresholdNoticeFundedCost", l."runOutNoticeFundedCost",
             l."projectId", l."projectElementId",
             c."salesPersonId", c."createdBy", p."ownerId" AS "projectOwnerId"
      FROM "customerContractLine" l
      JOIN "customerContract" c
        ON c."id" = l."customerContractId" AND c."companyId" = l."companyId"
      LEFT JOIN "project" p
        ON p."id" = l."projectId" AND p."companyId" = l."companyId"
      WHERE l."companyId" = ${companyId} AND c."status" = 'Active'
    ) lines
    WHERE "billingMethod" <> 'Fixed'
      AND "fundedCost" IS NOT NULL
      AND "projectElementId" IS NOT NULL
      AND "startDate" <= ${asOf}::date
      AND ("endDate" IS NULL OR "endDate" >= ${asOf}::date)
    ORDER BY "contractReadableId", "lineNumber"
  `.execute(db);
  if (lineRows.length === 0) return [];
  const lines: (FundingLine & {
    projectId: string;
    projectElementId: string;
  })[] = lineRows.map((row) => ({
    ...row,
    fundedCost: Number(row.fundedCost),
    noticePercent: Number(row.noticePercent),
    noticeWindowDays: Number(row.noticeWindowDays),
    thresholdNoticeFundedCost:
      row.thresholdNoticeFundedCost === null
        ? null
        : Number(row.thresholdNoticeFundedCost),
    runOutNoticeFundedCost:
      row.runOutNoticeFundedCost === null
        ? null
        : Number(row.runOutNoticeFundedCost)
  }));
  const lineIds = lines.map((line) => line.id);

  // 2. The funding position of every line, one call.
  const { rows: positions } = await sql<{
    customerContractLineId: string;
    incurred: number;
    recentCost: number;
  }>`
    SELECT "customerContractLineId", "incurred", "recentCost"
    FROM get_contract_line_funding(${companyId}, ${lineIds}::text[], ${asOf}::date)
  `.execute(db);
  const funding = new Map(
    positions.map((row) => [
      row.customerContractLineId,
      { incurred: Number(row.incurred), recentCost: Number(row.recentCost) }
    ])
  );

  // 3. Each project's cost summary once, and every element of those projects.
  const projectIds = [...new Set(lines.map((line) => line.projectId))];
  const summaries = new Map<
    string,
    {
      projectElementId: string | null;
      planMaterial: number;
      planLabor: number;
      planOther: number;
      committed: number;
      actual: number;
    }[]
  >();
  for (const projectId of projectIds) {
    // One call per distinct project: the function takes a single project.
    const { rows } = await sql<{
      projectElementId: string | null;
      planMaterial: number;
      planLabor: number;
      planOther: number;
      committed: number;
      actual: number;
    }>`
      SELECT "projectElementId", "planMaterial", "planLabor", "planOther",
             "committed", "actual"
      FROM get_project_cost_summary(${projectId}, ${companyId})
    `.execute(db);
    summaries.set(projectId, rows);
  }
  const elements = await db
    .selectFrom("projectElement")
    .select(["id", "parentId", "projectId", "estimateAtCompletion"])
    .where("companyId", "=", companyId)
    .where("projectId", "in", projectIds)
    .execute();
  const elementById = new Map(elements.map((element) => [element.id, element]));

  const costs = new Map<string, SubtreeCost>();
  for (const line of lines) {
    const subtree = sumSubtree(
      summaries.get(line.projectId) ?? [],
      elements.filter((element) => element.projectId === line.projectId),
      line.projectElementId
    );
    const override = elementById.get(
      line.projectElementId
    )?.estimateAtCompletion;
    costs.set(line.id, {
      ...subtree,
      override:
        override === null || override === undefined ? null : Number(override)
    });
  }

  const currency = await db
    .selectFrom("company as co")
    .leftJoin("currency as cu", (join) =>
      join
        .onRef("cu.code", "=", "co.baseCurrencyCode")
        .onRef("cu.companyGroupId", "=", "co.companyGroupId")
    )
    .select(["co.baseCurrencyCode", "cu.decimalPlaces"])
    .where("co.id", "=", companyId)
    .executeTakeFirst();

  // 4. The notices.
  const notices = buildFundingNotices(lines, funding, costs, asOf, {
    code: currency?.baseCurrencyCode ?? "USD",
    decimalPlaces: Number(currency?.decimalPlaces ?? 2)
  });

  // 5. Stamp the funded cost each notice went out for, one update per kind.
  const sent = notices.filter((notice) => notice.userIds.length > 0);
  const thresholdIds = sent
    .filter((notice) => notice.kind === "threshold")
    .map((notice) => notice.customerContractLineId);
  const runOutIds = sent
    .filter((notice) => notice.kind === "runOut")
    .map((notice) => notice.customerContractLineId);
  if (thresholdIds.length > 0) {
    await db
      .updateTable("customerContractLine")
      .set({ thresholdNoticeFundedCost: sql`"fundedCost"` })
      .where("companyId", "=", companyId)
      .where("id", "in", thresholdIds)
      .execute();
  }
  if (runOutIds.length > 0) {
    await db
      .updateTable("customerContractLine")
      .set({ runOutNoticeFundedCost: sql`"fundedCost"` })
      .where("companyId", "=", companyId)
      .where("id", "in", runOutIds)
      .execute();
  }

  return notices;
}
