// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CSV_CONTENT_TYPE, encodeCsv } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import { toDisplayCredit, toDisplayDebit } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { getAllGeneralLedgerLines } from "~/modules/accounting/accounting.service";
import type { AccountClass } from "~/modules/accounting/types";
import { resolveGeneralLedgerRequest } from "./general-ledger.server";

const logger = getLogger("erp", "reports-general-ledger-csv");

// Every line of the period with the page's filters, not only the page on
// screen — the general ledger is exported to be worked on elsewhere.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, selectedCompany, query } =
    await resolveGeneralLedgerRequest(request);

  const lines = await getAllGeneralLedgerLines(
    client,
    selectedCompany.id,
    query
  );
  if (lines.error) {
    logger.error("Failed to export general ledger", {
      companyId: selectedCompany.id,
      error: lines.error
    });
    throw new Response("The general ledger could not be exported.", {
      status: 500
    });
  }

  const csv = encodeCsv(
    (lines.data ?? []).map((line) => {
      const accountClass = (line.account?.class ?? "Asset") as AccountClass;
      return {
        Date: line.postingDate,
        "Journal Entry": line.journalEntryId,
        Status: line.status,
        "Account Number": line.account?.number,
        "Account Name": line.account?.name,
        Description: line.description ?? line.journalDescription,
        Source: line.sourceType,
        "Document Type": line.documentType,
        Debit: toDisplayDebit(line.amount ?? 0, accountClass),
        Credit: toDisplayCredit(line.amount ?? 0, accountClass),
        Currency: selectedCompany.baseCurrencyCode
      };
    }),
    {
      fields: [
        "Date",
        "Journal Entry",
        "Status",
        "Account Number",
        "Account Name",
        "Description",
        "Source",
        "Document Type",
        "Debit",
        "Credit",
        "Currency"
      ]
    }
  );

  return new Response(csv, {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="general-ledger-${query.startDate}-to-${query.endDate}.csv"`
    }
  });
}
