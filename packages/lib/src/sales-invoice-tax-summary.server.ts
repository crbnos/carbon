// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SalesInvoicePDF } from "@carbon/documents/pdf";
import {
  buildTaxSummary,
  getInvoiceMessages,
  getSalesInvoiceTaxTotal,
  isPostedSalesInvoiceStatus,
  lineTaxSummaryEntries,
  postedTaxSummaryEntries,
  resolveSellerRegistration,
  salesInvoiceTaxSummaryLines,
  TAX_CODE_SUMMARY_SELECT,
  type TaxCodeSummaryRow,
  toTaxSummaryCodes
} from "@carbon/documents/utils";
import { getLogger } from "@carbon/logger";
import { DEFAULT_CURRENCY_DECIMALS, datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

const logger = getLogger("lib", "sales-invoice-tax-summary");

type Client = SupabaseClient<Database>;

type SalesInvoicePDFProps = Parameters<typeof SalesInvoicePDF>[0];

type SalesInvoiceLine = Database["public"]["Views"]["salesInvoiceLines"]["Row"];

/**
 * The invoice's tax summary, VAT clauses and seller registration. A posted
 * invoice's summary comes from its `taxLedger` posting rows; a draft's from
 * splitting each line's tax across its code's components. One round of reads,
 * none per line, all through `taxClient`.
 */
export async function loadTaxSummary(args: {
  /** Service-role client: the caller has already checked its permission. */
  taxClient: Client;
  companyId: string;
  invoiceId: string;
  company: {
    countryCode: string | null;
    stateProvince: string | null;
    taxId: string | null;
    timezone: string | null;
  };
  salesInvoice: Database["public"]["Views"]["salesInvoices"]["Row"];
  lines: SalesInvoiceLine[];
  headerShipping: number;
  currencyDecimals: number | null;
}): Promise<
  Pick<
    SalesInvoicePDFProps,
    "taxSummary" | "invoiceMessages" | "sellerRegistration"
  >
> {
  const { taxClient: client, companyId, invoiceId, lines } = args;
  const date =
    args.salesInvoice.dateIssued ??
    datetime.today(args.company.timezone ?? "UTC").toString();

  const taxCodeIds = [
    ...new Set(
      lines
        .map((line) => line.taxCodeId)
        .filter((id): id is string => Boolean(id))
    )
  ];

  const [taxCodes, taxRegistrations, activeTaxCode, taxLedger] =
    await Promise.all([
      taxCodeIds.length > 0
        ? client
            .from("taxCode")
            .select(TAX_CODE_SUMMARY_SELECT)
            .eq("companyId", companyId)
            .in("id", taxCodeIds)
        : null,
      client
        .from("taxRegistration")
        .select(
          "countryCode, state, registrationNumber, effectiveDate, endDate"
        )
        .eq("companyId", companyId),
      // Has the company adopted tax codes? Decides whether `company.taxId`
      // prints as the seller's tax number.
      client
        .from("taxCode")
        .select("id")
        .eq("companyId", companyId)
        .eq("active", true)
        .limit(1),
      client
        .from("taxLedger")
        .select(
          "journalId, createdAt, componentName, taxPercent, documentTaxableAmount, documentTaxAmount"
        )
        .eq("companyId", companyId)
        .eq("documentType", "Sales Invoice")
        .eq("documentId", invoiceId)
    ]);
  for (const [name, result] of [
    ["taxCodes", taxCodes],
    ["taxRegistrations", taxRegistrations],
    ["activeTaxCode", activeTaxCode],
    ["taxLedger", taxLedger]
  ] as const) {
    if (result?.error) {
      logger.error("Failed to load {name}", { name, error: result.error });
    }
  }

  const codes = toTaxSummaryCodes(
    taxCodes?.data as TaxCodeSummaryRow[] | null | undefined
  );
  const entries =
    postedTaxSummaryEntries(
      taxLedger.data ?? [],
      isPostedSalesInvoiceStatus(args.salesInvoice.status)
    ) ??
    lineTaxSummaryEntries(
      salesInvoiceTaxSummaryLines(lines, args.headerShipping),
      codes,
      date
    );

  return {
    taxSummary: buildTaxSummary(
      entries,
      getSalesInvoiceTaxTotal(lines, args.salesInvoice),
      args.currencyDecimals ?? DEFAULT_CURRENCY_DECIMALS
    ),
    invoiceMessages: getInvoiceMessages(
      lines.map((line) => line.taxCodeId),
      codes
    ),
    sellerRegistration: resolveSellerRegistration(
      taxRegistrations.data,
      args.company,
      date,
      (activeTaxCode.data?.length ?? 0) > 0
    )
  };
}
