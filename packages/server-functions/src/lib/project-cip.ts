// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The CIP cost rows of capital projects. A cost charged to a Capitalize
// project posts to the asset account of the asset it builds
// (resolveProjectPostingAccount). The poster also writes one
// fixedAssetCipCost row per cost, and raises the asset's acquisitionCost.
// Capitalization (post-asset-transfer `capitalizeCip`) sums these rows.
// Spec: .ai/specs/2026-10-03-projects.md (Capital projects).

import type { Database } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { round } from "@carbon/utils";
import { sql, type Transaction } from "kysely";
import type { ResolvedProjectPostingAccount } from "./project-posting";

export type ProjectCipSourceType =
  | "Timesheet"
  | "Project Issue"
  | "Receipt"
  | "Purchase Invoice"
  | "Charge"
  | "Reimbursement";

export type ProjectCipRow =
  Database["public"]["Tables"]["fixedAssetCipCost"]["Insert"] & {
    fixedAssetId: string;
    amount: number;
    postCapitalization: boolean;
  };

/**
 * The CIP cost row of one project cost, or null when the cost builds no
 * asset (every treatment but Capitalize). The amount is rounded at internal
 * precision.
 */
export function buildProjectCipRow(args: {
  resolved: Pick<
    ResolvedProjectPostingAccount,
    "fixedAssetId" | "postCapitalization"
  >;
  companyId: string;
  userId: string;
  projectId: string;
  projectElementId: string | null;
  sourceType: ProjectCipSourceType;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  jobId?: string | null;
  amount: number;
  costDate: string;
  journalId: string | null;
}): ProjectCipRow | null {
  if (!args.resolved.fixedAssetId) return null;
  return {
    companyId: args.companyId,
    fixedAssetId: args.resolved.fixedAssetId,
    sourceType: args.sourceType,
    sourceDocumentId: args.sourceDocumentId,
    sourceDocumentLineId: args.sourceDocumentLineId ?? null,
    jobId: args.jobId ?? null,
    projectId: args.projectId,
    projectElementId: args.projectElementId,
    amount: round(args.amount),
    costDate: args.costDate,
    journalId: args.journalId,
    postCapitalization: args.resolved.postCapitalization,
    createdBy: args.userId
  };
}

/**
 * The amount each asset's acquisitionCost rises by. A row adds its amount
 * when its asset is Under Construction (`postCapitalization` false: the
 * resolver gives no row for any other status) or when it is a late cost on
 * an in-service asset (`postCapitalization` true).
 */
export function assetCostIncrements(
  rows: Pick<ProjectCipRow, "fixedAssetId" | "amount">[]
): Map<string, number> {
  const increments = new Map<string, number>();
  for (const row of rows) {
    increments.set(
      row.fixedAssetId,
      round((increments.get(row.fixedAssetId) ?? 0) + row.amount)
    );
  }
  return increments;
}

/**
 * Inserts the CIP cost rows and raises each touched asset's acquisitionCost
 * by its increment, in one insert and one `UPDATE … FROM (VALUES …)`. Call
 * it after the journal, so each row carries its `journalId`.
 */
export async function writeProjectCipRows(
  trx: Transaction<DB>,
  args: { companyId: string; userId: string; rows: (ProjectCipRow | null)[] }
): Promise<void> {
  const rows = args.rows.filter((row): row is ProjectCipRow => row !== null);
  if (rows.length === 0) return;

  await trx.insertInto("fixedAssetCipCost").values(rows).execute();

  const increments = [...assetCostIncrements(rows)].filter(
    ([, amount]) => amount !== 0
  );
  if (increments.length === 0) return;
  await sql`
    UPDATE "fixedAsset" a
    SET "acquisitionCost" = a."acquisitionCost" + v."amount",
        "updatedBy" = ${args.userId},
        "updatedAt" = NOW()
    FROM (VALUES ${sql.join(
      increments.map(
        ([fixedAssetId, amount]) => sql`(${fixedAssetId}, ${amount}::numeric)`
      )
    )}) AS v("id", "amount")
    WHERE a."id" = v."id" AND a."companyId" = ${args.companyId}
  `.execute(trx);
}
