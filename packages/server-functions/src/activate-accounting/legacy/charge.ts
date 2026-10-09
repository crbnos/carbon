// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal of a legacy charge: the lines `post-charge` writes today, from
// the stored charge and its lines (.ai/specs/implemented/2026-10-08-accounting-cutover.md
// section 5a). Every input is stored: the card and offset accounts on the
// charge, and each line's account, cost center and project.
//
// Mirrors post-charge/post-charge-post.ts (`postChargeJournal`): the lines of
// `buildChargeJournal`, quantity 1, one journal line reference per charge,
// the Cost Center and Project dimensions (`costCenterAndProjectDimensions`),
// dated `postingDate`, else `transactionDate`. The posting's
// account checks (active, posting, class) are not repeated: the charge
// passed them when it posted, and the builder still refuses an account with
// no class.

import type { KyselyTx } from "@carbon/database/client";
import { legacyCharges } from "@carbon/database/legacy-documents";
import { type AccountClass, isAccountClass } from "@carbon/utils";
import { nanoid } from "nanoid";
import { costCenterAndProjectDimensions } from "../../lib/cost-center-project-dimensions";
import { buildChargeJournal } from "../../post-charge/build-charge-journal";
import { type LegacyDocumentJournal, readByIds } from "./write";

export async function buildLegacyChargeJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    cutoverDate
  }: { companyId: string; companyGroupId: string; cutoverDate: string }
): Promise<LegacyDocumentJournal[]> {
  const charges = await legacyCharges(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (charges.length === 0) return [];

  const lines = await readByIds(
    charges.map((charge) => charge.id),
    (ids) =>
      trx
        .selectFrom("chargeLine")
        .selectAll()
        .where("companyId", "=", companyId)
        .where("chargeId", "in", ids)
        .orderBy("chargeId")
        .orderBy("sequence")
        .orderBy("id")
        .execute()
  );
  const accounts = await readByIds(
    [
      ...charges.flatMap((charge) => [
        charge.cardAccountId,
        charge.offsetAccountId
      ]),
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

  const linesByCharge = Map.groupBy(lines, (line) => line.chargeId);

  return charges.map((charge) => {
    const built = buildChargeJournal({
      transaction: {
        type: charge.type,
        amount: Number(charge.amount),
        cardAccountId: charge.cardAccountId,
        offsetAccountId: charge.offsetAccountId,
        currencyCode: charge.currencyCode,
        exchangeRate: Number(charge.exchangeRate)
      },
      lines: (linesByCharge.get(charge.id) ?? []).map((line) => ({
        accountId: line.accountId,
        amount: Number(line.amount),
        costCenterId: line.costCenterId,
        projectId: line.projectId,
        description: line.description
      })),
      accounts: accountClasses,
      documentId: charge.id,
      documentReadableId: charge.chargeId
    });
    const journalLineReference = nanoid();
    return {
      documentId: charge.id,
      description: `Charge ${charge.chargeId}`,
      postingDate: String(charge.postingDate ?? charge.transactionDate),
      sourceType: "Charge" as const,
      lines: built.journalLines.map((line) => ({
        accountId: line.accountId,
        amount: line.amount,
        quantity: 1,
        description: line.description,
        documentType: "Charge" as const,
        documentId: line.documentId,
        journalLineReference,
        dimensions: {},
        dimensionValues: [
          ...(dimensionIds.costCenter && line.costCenterId
            ? [
                {
                  dimensionId: dimensionIds.costCenter,
                  valueId: line.costCenterId
                }
              ]
            : []),
          ...(dimensionIds.project && line.projectId
            ? [{ dimensionId: dimensionIds.project, valueId: line.projectId }]
            : [])
        ]
      }))
    };
  });
}
