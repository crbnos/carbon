// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import {
  negateTaxLedgerRows,
  type TaxLedgerRow
} from "@carbon/database/tax-ledger";
import type { Transaction } from "kysely";

/**
 * A void's tax-ledger rows: every row the document wrote, negated, on the
 * void's journal and date. The liability report then nets the document to
 * zero. Writes nothing for a document that wrote no rows.
 */
export async function negateDocumentTaxLedger(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    documentType: TaxLedgerRow["documentType"];
    documentId: string;
    journalId: string;
    postingDate: string;
    createdBy: string;
  }
): Promise<void> {
  const rows = await trx
    .selectFrom("taxLedger")
    .select([
      "companyId",
      "createdBy",
      "source",
      "documentType",
      "documentId",
      "documentLineId",
      "journalId",
      "postingDate",
      "taxCodeId",
      "taxCodeComponentId",
      "componentName",
      "taxAuthorityId",
      "taxPercent",
      "recoverablePercent",
      "customerId",
      "supplierId",
      "taxableAmount",
      "taxAmount",
      "recoverableAmount",
      "exemptAmount",
      "documentTaxableAmount",
      "documentTaxAmount",
      "currencyCode",
      "exchangeRate",
      "taxExemptionReason",
      "exemptionCertificateNumber"
    ])
    .where("companyId", "=", args.companyId)
    .where("documentType", "=", args.documentType)
    .where("documentId", "=", args.documentId)
    .execute();
  if (rows.length === 0) return;
  await trx
    .insertInto("taxLedger")
    .values(
      negateTaxLedgerRows(rows as TaxLedgerRow[], {
        journalId: args.journalId,
        postingDate: args.postingDate,
        createdBy: args.createdBy
      })
    )
    .execute();
}
