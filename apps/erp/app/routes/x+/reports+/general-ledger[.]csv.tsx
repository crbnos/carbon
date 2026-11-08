// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CSV_CONTENT_TYPE, encodeCsvTable } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import { toDisplayCredit, toDisplayDebit } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import {
  getAllGeneralLedgerLines,
  getGeneralLedgerDimensions,
  withGeneralLedgerCounterparties,
  withGeneralLedgerDimensions
} from "~/modules/accounting/accounting.service";
import type { AccountClass } from "~/modules/accounting/types";
import { resolveGeneralLedgerRequest } from "./general-ledger.server";

const logger = getLogger("erp", "reports-general-ledger-csv");

// Every line of the period with the page's filters, not only the page on
// screen — the general ledger is exported to be worked on elsewhere.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, selectedCompany, companyGroupId, query } =
    await resolveGeneralLedgerRequest(request);

  const [lines, dimensions] = await Promise.all([
    getAllGeneralLedgerLines(client, selectedCompany.id, query),
    getGeneralLedgerDimensions(client, companyGroupId)
  ]);
  if (lines.error || dimensions.error) {
    logger.error("Failed to export general ledger", {
      companyId: selectedCompany.id,
      error: lines.error ?? dimensions.error
    });
    throw new Response("The general ledger could not be exported.", {
      status: 500
    });
  }

  const counterparties = await withGeneralLedgerCounterparties(
    client,
    selectedCompany.id,
    lines.data ?? []
  );
  const rows = counterparties.error
    ? counterparties
    : await withGeneralLedgerDimensions(
        client,
        selectedCompany.id,
        counterparties.data
      );
  if (rows.error) {
    logger.error("Failed to read the general ledger's documents", {
      companyId: selectedCompany.id,
      error: rows.error
    });
    throw new Response("The general ledger could not be exported.", {
      status: 500
    });
  }

  // One column per dimension after the fixed ones, headed by its name
  const dimensionList = dimensions.data ?? [];
  const csv = encodeCsvTable(
    [
      "Date",
      "Journal Entry",
      "Status",
      "Account Number",
      "Account Name",
      "Description",
      "Debit",
      "Credit",
      "Currency",
      "Source",
      "Document Type",
      "Customer / Supplier",
      "Invoice Number",
      "Supplier Invoice Number",
      "Purchase Order",
      ...dimensionList.map((dimension) => dimension.name)
    ],
    rows.data.map((line) => {
      const accountClass = (line.account?.class ?? "Asset") as AccountClass;
      return [
        line.postingDate,
        line.journalEntryId,
        line.status,
        line.account?.number,
        line.account?.name,
        line.description ?? line.journalDescription,
        toDisplayDebit(line.amount ?? 0, accountClass),
        toDisplayCredit(line.amount ?? 0, accountClass),
        selectedCompany.baseCurrencyCode,
        line.sourceType,
        line.documentType,
        line.party,
        line.invoiceNumber,
        line.supplierInvoiceNumber,
        line.purchaseOrderNumber,
        ...dimensionList.map((dimension) => line.dimensions[dimension.id])
      ].map((cell) => cell ?? "");
    })
  );

  return new Response(csv, {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="general-ledger-${query.startDate}-to-${query.endDate}.csv"`
    }
  });
}
