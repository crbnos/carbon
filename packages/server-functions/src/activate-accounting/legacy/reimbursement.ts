// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal of a legacy reimbursement: the lines `post-reimbursement`
// writes today, from the stored reimbursement and its lines
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a).
//
// Mirrors post-reimbursement/post-reimbursement-post.ts
// (`postReimbursementJournal`): the payable account stored on the row, else
// today's employee reimbursements payable default, else payables; the lines
// of `buildReimbursementJournal`, quantity 1, one journal line reference per
// reimbursement; each coding line's Cost Center and Project dimension, with
// its `reimbursementLineDimension` rows winning over them; dated
// `postingDate`, else `reimbursementDate`. Two differences: a line dimension
// that is no longer active is left off rather than refused (the posting
// refuses it, and the enable must not fail on it), and the posting's account
// checks (active, posting, class) are not repeated, as the reimbursement
// passed them when it posted.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { legacyReimbursements } from "@carbon/database/legacy-documents";
import { type AccountClass, isAccountClass } from "@carbon/utils";
import { nanoid } from "nanoid";
import { buildReimbursementJournal } from "../../post-reimbursement/build-reimbursement-journal";
import { costCenterAndProjectDimensions } from "./charge";
import { type LegacyDocumentJournal, readByIds } from "./write";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

export async function buildLegacyReimbursementJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    cutoverDate,
    defaults
  }: {
    companyId: string;
    companyGroupId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
  }
): Promise<LegacyDocumentJournal[]> {
  const reimbursements = await legacyReimbursements(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (reimbursements.length === 0) return [];

  const lines = await readByIds(
    reimbursements.map((reimbursement) => reimbursement.id),
    (ids) =>
      trx
        .selectFrom("reimbursementLine")
        .selectAll()
        .where("companyId", "=", companyId)
        .where("reimbursementId", "in", ids)
        .orderBy("reimbursementId")
        .orderBy("sequence")
        .orderBy("id")
        .execute()
  );
  const payableAccountOf = (payableAccountId: string | null) => {
    const accountId =
      payableAccountId ??
      defaults.employeeReimbursementsPayableAccount ??
      defaults.payablesAccount;
    if (!accountId) {
      throw new Error(
        "No employee reimbursements payable account and no payables account is configured"
      );
    }
    return accountId;
  };
  const accounts = await readByIds(
    [
      ...reimbursements.map((reimbursement) =>
        payableAccountOf(reimbursement.payableAccountId)
      ),
      ...lines.map((line) => line.accountId)
    ],
    (ids) =>
      trx
        .selectFrom("account")
        .select(["id", "class"])
        .where("companyGroupId", "=", companyGroupId)
        .where("id", "in", ids)
        .execute()
  );
  const accountClasses: Record<string, { class: AccountClass }> = {};
  for (const account of accounts) {
    if (isAccountClass(account.class)) {
      accountClasses[account.id] = { class: account.class };
    }
  }
  const dimensionIds = await costCenterAndProjectDimensions(
    trx,
    companyGroupId
  );
  const lineDimensions = await readByIds(
    lines.map((line) => line.id),
    (ids) =>
      trx
        .selectFrom("reimbursementLineDimension as lineDimension")
        .innerJoin("dimension", "dimension.id", "lineDimension.dimensionId")
        .select([
          "lineDimension.reimbursementLineId",
          "lineDimension.dimensionId",
          "lineDimension.valueId"
        ])
        .where("lineDimension.companyId", "=", companyId)
        .where("lineDimension.reimbursementLineId", "in", ids)
        .where("dimension.companyGroupId", "=", companyGroupId)
        .where("dimension.active", "=", true)
        .orderBy("lineDimension.dimensionId")
        .execute()
  );

  const linesByReimbursement = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = linesByReimbursement.get(line.reimbursementId) ?? [];
    list.push(line);
    linesByReimbursement.set(line.reimbursementId, list);
  }
  const dimensionsByLine = new Map<string, typeof lineDimensions>();
  for (const row of lineDimensions) {
    const list = dimensionsByLine.get(row.reimbursementLineId) ?? [];
    list.push(row);
    dimensionsByLine.set(row.reimbursementLineId, list);
  }

  return reimbursements.map((reimbursement) => {
    const codingLines = linesByReimbursement.get(reimbursement.id) ?? [];
    const payableAccountId = payableAccountOf(reimbursement.payableAccountId);
    const built = buildReimbursementJournal({
      reimbursement: {
        amount: Number(reimbursement.amount),
        payableAccountId,
        currencyCode: reimbursement.currencyCode,
        exchangeRate: Number(reimbursement.exchangeRate)
      },
      lines: codingLines.map((line) => ({
        accountId: line.accountId,
        amount: Number(line.amount),
        costCenterId: line.costCenterId,
        projectId: line.projectId,
        description: line.description
      })),
      accounts: accountClasses,
      documentId: reimbursement.id,
      documentReadableId: reimbursement.reimbursementId
    });
    // One debit per coding line in order, then the payable credit.
    if (
      built.journalLines.length !== codingLines.length + 1 ||
      codingLines.some(
        (line, index) => built.journalLines[index]?.accountId !== line.accountId
      )
    ) {
      throw new Error("Reimbursement journal lines do not match coding lines");
    }
    const journalLineReference = nanoid();
    return {
      documentId: reimbursement.id,
      payableAccountId,
      description: `Reimbursement ${reimbursement.reimbursementId}`,
      postingDate: String(
        reimbursement.postingDate ?? reimbursement.reimbursementDate
      ),
      sourceType: "Reimbursement" as const,
      lines: built.journalLines.map((line, index) => {
        const codingLine = codingLines[index];
        // The trailing payable leg is a control account and carries no
        // coding. A line's own dimension rows win over its columns.
        const byDimension = new Map<string, string>();
        if (codingLine) {
          if (dimensionIds.costCenter && line.costCenterId) {
            byDimension.set(dimensionIds.costCenter, line.costCenterId);
          }
          if (dimensionIds.project && line.projectId) {
            byDimension.set(dimensionIds.project, line.projectId);
          }
          for (const row of dimensionsByLine.get(codingLine.id) ?? []) {
            byDimension.set(row.dimensionId, row.valueId);
          }
        }
        return {
          accountId: line.accountId,
          amount: line.amount,
          quantity: 1,
          description: line.description,
          documentType: "Reimbursement" as const,
          documentId: line.documentId,
          journalLineReference,
          dimensions: {},
          dimensionValues: [...byDimension].map(([dimensionId, valueId]) => ({
            dimensionId,
            valueId
          }))
        };
      })
    };
  });
}
