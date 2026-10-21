// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// One journal for one project charge: the status and period, the journal
// header, its lines and their dimension tags. Used by post-project-expense
// and reclass-project-coverage. The journal is Provisional before the
// company's accounting cutover and Posted after it.

import type { Database } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { journalPostingStatus } from "@carbon/database/journal-posting-status";
import type { Transaction } from "kysely";
import { nanoid } from "nanoid";
import {
  allocateJournalLineIds,
  createAdjustmentJournal,
  resolveAccountingPeriod
} from "~/modules/shared/shared.service";

type DimensionEntityType = Database["public"]["Enums"]["dimensionEntityType"];

export type ProjectJournalLine = {
  accountId: string;
  description: string;
  /** Natural-balance signed, the journalLine convention. */
  amount: number;
};

/**
 * Writes one journal dated `postingDate`, with every
 * line tagged by each active dimension in `dimensions` that has a value.
 * Before the company's accounting cutover the journal is Provisional and has
 * no accounting period; after it, Posted in the period of `postingDate`.
 * Returns the journal id and the line ids, in the order of `lines`.
 */
export async function postProjectJournal(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    postingDate: string;
    description: string;
    sourceType: Database["public"]["Enums"]["journalEntrySourceType"];
    documentType: Database["public"]["Enums"]["journalLineDocumentType"];
    documentId: string;
    documentLineReference: string;
    lines: ProjectJournalLine[];
    dimensions: [DimensionEntityType, string | null | undefined][];
  }
): Promise<{ journalId: string; lineIds: string[] }> {
  const { companyId } = args;
  // FOR SHARE holds the status until the caller's transaction commits.
  const status = await journalPostingStatus(trx, companyId);
  const accountingPeriodId =
    status === "Posted"
      ? (
          await resolveAccountingPeriod(
            trx,
            companyId,
            args.postingDate,
            "current"
          )
        ).id
      : null;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId,
    status,
    description: args.description,
    postingDate: args.postingDate,
    userId: args.userId,
    sourceType: args.sourceType
  });

  const lineIds = await allocateJournalLineIds(trx, args.lines.length);
  const journalLineReference = nanoid();
  await trx
    .insertInto("journalLine")
    .values(
      args.lines.map((line, index) => ({
        id: lineIds[index]!,
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: line.amount,
        quantity: 1,
        documentType: args.documentType,
        documentId: args.documentId,
        documentLineReference: args.documentLineReference,
        journalLineReference,
        companyId
      }))
    )
    .execute();

  const tagged = args.dimensions.filter(
    (pair): pair is [DimensionEntityType, string] => Boolean(pair[1])
  );
  if (tagged.length > 0) {
    const dimensions = await trx
      .selectFrom("dimension")
      .innerJoin(
        "company",
        "company.companyGroupId",
        "dimension.companyGroupId"
      )
      .select(["dimension.id", "dimension.entityType"])
      .where("company.id", "=", companyId)
      .where("dimension.active", "=", true)
      .where(
        "dimension.entityType",
        "in",
        tagged.map(([entityType]) => entityType)
      )
      .execute();
    const dimensionIdByType = new Map(
      dimensions
        .filter((d) => d.entityType)
        .map((d) => [d.entityType as string, d.id])
    );
    const rows = lineIds.flatMap((journalLineId) =>
      tagged.flatMap(([entityType, valueId]) => {
        const dimensionId = dimensionIdByType.get(entityType);
        return dimensionId
          ? [{ journalLineId, dimensionId, valueId, companyId }]
          : [];
      })
    );
    if (rows.length > 0) {
      await trx.insertInto("journalLineDimension").values(rows).execute();
    }
  }

  return { journalId, lineIds };
}
