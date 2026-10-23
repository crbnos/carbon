// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Project WIP relief at close (accounting audit D11, D12). Closing a Contract
// project moves the Project WIP that no progress contract line owns to cost
// of goods sold, in one journal: Dr cost of goods sold / Cr the account each
// ledger row's journal line debited, grouped by that account. The rows are
// the ones the revenue run's cost relief would take (an Asset account other
// than an inventory account), less the rows a live Right to Invoice or
// Percent Complete line owns (`progressLedgerRows`): those stay for the run.
// Each relieved row gets a `projectCostRelief` row that names the journal, so
// neither the run nor a later close relieves it again. Server-only.

import type { KyselyTx } from "@carbon/database/client";
import { assertBalanced, round } from "@carbon/utils";
import { sql } from "kysely";
import {
  loadProgressLines,
  lockProjectRevenue,
  progressLedgerRows
} from "~/modules/accounting/project-revenue";
import { postProjectJournal } from "./project-journal";
import { onInventoryAccount } from "./project-posting";

const INSERT_BATCH_SIZE = 1000;

/** A line on any contract, whenever it starts, may own the project's rows. */
const EVERY_LINE_START = "9999-12-31";

/** A close the company's setup refuses (no cost of goods sold default). */
export class ProjectCloseError extends Error {}

type ReliefGroup = {
  accountId: string;
  amount: number;
  rows: { id: string; amount: number }[];
};

/**
 * The unrelieved Project WIP of a closing project that no progress contract
 * line owns, posted on or before `closeDate`, grouped by the account its
 * journal lines debited. The project's own rows, and (D12) the Contract
 * coverage rows of the Service projects it is the contract project of: those
 * post to this project's account, on elements no line of it can bill.
 */
export async function selectUnrelievedCloseCost(
  trx: KyselyTx,
  args: { companyId: string; projectId: string; closeDate: string }
): Promise<ReliefGroup[]> {
  const { companyId, projectId, closeDate } = args;
  const lines = (
    await loadProgressLines(trx, {
      companyId,
      periodEnd: EVERY_LINE_START,
      revenueMethods: ["Right to Invoice", "Percent Complete"]
    })
  ).filter((line) => line.projectId === projectId);
  const owned =
    lines.length > 0
      ? sql`AND NOT EXISTS (
          SELECT 1 FROM (${progressLedgerRows({
            companyId,
            lines,
            through: closeDate
          })}) o
          WHERE o."projectLedgerId" = pl."id"
        )`
      : sql``;

  const { rows } = await sql<{ accountId: string; id: string; amount: number }>`
    SELECT jl."accountId", pl."id", pl."amount"
    FROM "projectLedger" pl
    JOIN "project" p ON p."id" = pl."projectId" AND p."companyId" = pl."companyId"
    JOIN "journalLine" jl
      ON jl."id" = pl."journalLineId" AND jl."companyId" = pl."companyId"
    JOIN "account" a ON a."id" = jl."accountId" AND a."class" = 'Asset'
    WHERE pl."companyId" = ${companyId}
      AND pl."postingDate" <= ${closeDate}::date
      AND (
        pl."projectId" = ${projectId}
        OR (
          p."parentProjectId" = ${projectId}
          AND p."projectType" = 'Service'
          AND pl."coverage" = 'Contract'
        )
      )
      -- Cost still in stock is not WIP (C2), as in the run's cost relief.
      AND NOT ${onInventoryAccount("pl")}
      AND NOT EXISTS (
        SELECT 1 FROM "projectCostRelief" r
        WHERE r."projectLedgerId" = pl."id" AND r."companyId" = pl."companyId"
      )
      ${owned}
    ORDER BY jl."accountId", pl."postingDate", pl."id"
  `.execute(trx);

  const groups = new Map<string, ReliefGroup>();
  for (const row of rows) {
    const group = groups.get(row.accountId) ?? {
      accountId: row.accountId,
      amount: 0,
      rows: []
    };
    group.amount += Number(row.amount);
    group.rows.push({ id: row.id, amount: Number(row.amount) });
    groups.set(row.accountId, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    amount: round(group.amount)
  }));
}

/**
 * Relieves a closing Contract project's unowned Project WIP to cost of goods
 * sold (see the file header), dated `closeDate`. Provisional before the
 * accounting cutover, Posted in the period of `closeDate` after it
 * (`postProjectJournal`). A group that nets to 0 writes nothing and its rows
 * stay unrelieved, as in the run. Returns the journal, or null when there
 * was nothing to relieve.
 */
export async function relieveProjectWipAtClose(
  trx: KyselyTx,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    identifier: string | null;
    closeDate: string;
  }
): Promise<{ journalId: string; amount: number } | null> {
  const { companyId, projectId, closeDate } = args;
  // The revenue run's lock: a run and a close never relieve one row at once.
  await lockProjectRevenue(trx, companyId);
  const groups = (await selectUnrelievedCloseCost(trx, args)).filter(
    (group) => group.amount !== 0
  );
  if (groups.length === 0) return null;

  const defaults = await trx
    .selectFrom("accountDefault")
    .select("costOfGoodsSoldAccount")
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults?.costOfGoodsSoldAccount) {
    throw new ProjectCloseError(
      "Set the Cost of Goods Sold account default before you close the project"
    );
  }

  const label = args.identifier ?? projectId;
  // Both accounts are debit-normal: a positive amount debits, a negative one
  // credits (a group that nets negative swaps the sides).
  const lines = groups.flatMap((group) => [
    {
      accountId: defaults.costOfGoodsSoldAccount,
      description: `${label} closed: Project WIP to cost of goods sold`,
      amount: group.amount
    },
    {
      accountId: group.accountId,
      description: `${label} closed: Project WIP to cost of goods sold`,
      amount: -group.amount
    }
  ]);
  const debits = lines.reduce(
    (sum, line) => sum + (line.amount > 0 ? line.amount : 0),
    0
  );
  const credits = lines.reduce(
    (sum, line) => sum + (line.amount < 0 ? -line.amount : 0),
    0
  );
  assertBalanced(debits, credits, undefined, "Project close journal");

  const { journalId } = await postProjectJournal(trx, {
    companyId,
    userId: args.userId,
    postingDate: closeDate,
    description: `Close ${label}`,
    sourceType: "Project Close",
    documentType: "Project Close",
    documentId: projectId,
    documentLineReference: projectId,
    lines,
    dimensions: [["Project", projectId]]
  });

  const values = groups.flatMap((group) =>
    group.rows.map((row) => ({
      companyId,
      projectLedgerId: row.id,
      revenueRecognitionScheduleId: null,
      journalId,
      amount: row.amount
    }))
  );
  for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
    await trx
      .insertInto("projectCostRelief")
      .values(values.slice(i, i + INSERT_BATCH_SIZE))
      .execute();
  }

  return {
    journalId,
    amount: round(groups.reduce((sum, group) => sum + group.amount, 0))
  };
}
