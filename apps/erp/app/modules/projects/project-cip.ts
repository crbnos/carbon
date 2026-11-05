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

/**
 * Removes the project CIP rows of a voided document and lowers each asset's
 * acquisitionCost by their sum, in one delete and one
 * `UPDATE … FROM (VALUES …)`. Refuses, before any write, when a row went in
 * under construction (`postCapitalization` false) and its asset has since
 * been capitalized: the capitalization already moved that cost out of CIP.
 * A late cost (`postCapitalization` true) comes off the in-service asset.
 * The Fixed Asset line rows of receipts and invoices (no `projectId`) keep
 * their own path.
 */
export async function reverseProjectCipRows(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    sourceType: ProjectCipSourceType;
    sourceDocumentId: string;
  }
): Promise<void> {
  const rows = await trx
    .selectFrom("fixedAssetCipCost")
    .innerJoin("fixedAsset", "fixedAsset.id", "fixedAssetCipCost.fixedAssetId")
    .select([
      "fixedAssetCipCost.id",
      "fixedAssetCipCost.fixedAssetId",
      "fixedAssetCipCost.amount",
      "fixedAssetCipCost.postCapitalization",
      "fixedAsset.fixedAssetId as assetReadableId",
      "fixedAsset.status"
    ])
    .where("fixedAssetCipCost.companyId", "=", args.companyId)
    .where("fixedAssetCipCost.sourceType", "=", args.sourceType)
    .where("fixedAssetCipCost.sourceDocumentId", "=", args.sourceDocumentId)
    .where("fixedAssetCipCost.projectId", "is not", null)
    .execute();
  if (rows.length === 0) return;

  for (const row of rows) {
    if (!row.postCapitalization && row.status !== "Under Construction") {
      throw new Error(
        `Asset ${row.assetReadableId} was capitalized; reverse the capitalization first`
      );
    }
    if (row.postCapitalization && row.status === "Disposed") {
      throw new Error(
        `Asset ${row.assetReadableId} was disposed; its late cost cannot be reversed`
      );
    }
  }

  await trx
    .deleteFrom("fixedAssetCipCost")
    .where("companyId", "=", args.companyId)
    .where(
      "id",
      "in",
      rows.map((row) => row.id)
    )
    .execute();

  const decrements = [
    ...assetCostIncrements(
      rows.map((row) => ({
        fixedAssetId: row.fixedAssetId,
        amount: Number(row.amount)
      }))
    )
  ].filter(([, amount]) => amount !== 0);
  if (decrements.length === 0) return;
  await sql`
    UPDATE "fixedAsset" a
    SET "acquisitionCost" = a."acquisitionCost" - v."amount",
        "updatedBy" = ${args.userId},
        "updatedAt" = NOW()
    FROM (VALUES ${sql.join(
      decrements.map(
        ([fixedAssetId, amount]) => sql`(${fixedAssetId}, ${amount}::numeric)`
      )
    )}) AS v("id", "amount")
    WHERE a."id" = v."id" AND a."companyId" = ${args.companyId}
  `.execute(trx);
}
