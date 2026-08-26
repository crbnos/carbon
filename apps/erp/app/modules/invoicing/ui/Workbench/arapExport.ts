import { csvText } from "../../../accounting/ui/Reports/exportReport";

export type ARAPSide = "ar" | "ap";
export type ARAPAgingMethod = "dueDate" | "documentDate";

export type AgingRow = {
  customerId?: string;
  supplierId?: string;
  paymentTerm?: string | null;
  current: number;
  bucket1: number;
  bucket2: number;
  bucket3: number;
  bucket4: number;
  unapplied: number;
  total: number;
};

export type OpenInvoiceRow = {
  invoiceId: string;
  invoiceNumber: string;
  documentType?: string;
  dateDue: string | null;
  currencyCode: string;
  exchangeRate: number;
  totalAmount: number;
  settled: number;
  openInCurrency: number;
  openInBase: number;
  customerId?: string;
  supplierId?: string;
};

type ARAPAgingExportArgs = {
  side: ARAPSide;
  baseCurrencyCode: string;
  aging: AgingRow[];
  open: OpenInvoiceRow[];
  asOfDate: string;
  agingMethod: ARAPAgingMethod;
  bucketDays: [number, number, number];
};

const partyIdOf = (
  side: ARAPSide,
  row: { customerId?: string; supplierId?: string }
) => (side === "ar" ? row.customerId : row.supplierId) ?? "";

export function buildARAPAgingExportRows({
  side,
  baseCurrencyCode,
  aging,
  open,
  asOfDate,
  agingMethod,
  bucketDays
}: ARAPAgingExportArgs): Record<string, unknown>[] {
  const [b1, b2, b3] = bucketDays;
  const bucketHeaders = [
    `1-${b1}`,
    `${b1 + 1}-${b2}`,
    `${b2 + 1}-${b3}`,
    `${b3 + 1}+`
  ];
  const sideLabel = side.toUpperCase();
  const counterpartyType = side === "ar" ? "Customer" : "Supplier";
  const rows: Record<string, unknown>[] = [];

  const invoicesByParty = new Map<string, OpenInvoiceRow[]>();
  for (const invoice of open) {
    const partyId = partyIdOf(side, invoice);
    const list = invoicesByParty.get(partyId) ?? [];
    list.push(invoice);
    invoicesByParty.set(partyId, list);
  }

  const pushInvoice = (invoice: OpenInvoiceRow) => {
    rows.push({
      "As Of Date": asOfDate,
      Side: sideLabel,
      "Aging Method": agingMethod,
      "Bucket Days": bucketDays.join(","),
      "Base Currency": baseCurrencyCode,
      "Row Type": "Invoice",
      "Counterparty Type": counterpartyType,
      "Counterparty ID": partyIdOf(side, invoice),
      "Payment Term": "",
      "Invoice ID": csvText(invoice.invoiceId),
      "Invoice Number": csvText(invoice.invoiceNumber),
      "Document Type": invoice.documentType ?? "",
      "Due Date": invoice.dateDue ?? "",
      Currency: invoice.currencyCode,
      "Current (Base Currency)": "",
      [`${bucketHeaders[0]} (Base Currency)`]: "",
      [`${bucketHeaders[1]} (Base Currency)`]: "",
      [`${bucketHeaders[2]} (Base Currency)`]: "",
      [`${bucketHeaders[3]} (Base Currency)`]: "",
      "Unapplied (Base Currency)": "",
      "Open Amount (Base Currency)": invoice.openInBase,
      "Open Amount (Invoice Currency)": invoice.openInCurrency,
      "Total Amount (Invoice Currency)": invoice.totalAmount,
      "Settled (Invoice Currency)": invoice.settled,
      "Exchange Rate (Invoice to Base)": invoice.exchangeRate
    });
  };

  const groupedPartyIds = new Set<string>();
  for (const agingRow of aging) {
    const partyId = partyIdOf(side, agingRow);
    if (!partyId) continue;
    groupedPartyIds.add(partyId);
    rows.push({
      "As Of Date": asOfDate,
      Side: sideLabel,
      "Aging Method": agingMethod,
      "Bucket Days": bucketDays.join(","),
      "Base Currency": baseCurrencyCode,
      "Row Type": "Counterparty",
      "Counterparty Type": counterpartyType,
      "Counterparty ID": partyId,
      "Payment Term": agingRow.paymentTerm ?? "",
      "Invoice ID": "",
      "Invoice Number": "",
      "Document Type": "",
      "Due Date": "",
      Currency: baseCurrencyCode,
      "Current (Base Currency)": agingRow.current,
      [`${bucketHeaders[0]} (Base Currency)`]: agingRow.bucket1,
      [`${bucketHeaders[1]} (Base Currency)`]: agingRow.bucket2,
      [`${bucketHeaders[2]} (Base Currency)`]: agingRow.bucket3,
      [`${bucketHeaders[3]} (Base Currency)`]: agingRow.bucket4,
      "Unapplied (Base Currency)": agingRow.unapplied,
      "Open Amount (Base Currency)": agingRow.total,
      "Open Amount (Invoice Currency)": "",
      "Total Amount (Invoice Currency)": "",
      "Settled (Invoice Currency)": "",
      "Exchange Rate (Invoice to Base)": ""
    });

    for (const invoice of invoicesByParty.get(partyId) ?? []) {
      pushInvoice(invoice);
    }
  }

  for (const invoice of open) {
    const partyId = partyIdOf(side, invoice);
    if (!groupedPartyIds.has(partyId)) pushInvoice(invoice);
  }

  return rows;
}

export function canDownloadARAPAgingExport(
  dataError: boolean | undefined,
  rowCount: number
): boolean {
  return !dataError && rowCount > 0;
}
