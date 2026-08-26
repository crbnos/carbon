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
      "Row Type": "Invoice",
      "Counterparty Type": counterpartyType,
      "Counterparty ID": partyIdOf(side, invoice),
      "Payment Term": "",
      "Invoice ID": invoice.invoiceId,
      "Invoice Number": invoice.invoiceNumber,
      "Document Type": invoice.documentType ?? "",
      "Due Date": invoice.dateDue ?? "",
      Currency: invoice.currencyCode,
      Current: "",
      [bucketHeaders[0]]: "",
      [bucketHeaders[1]]: "",
      [bucketHeaders[2]]: "",
      [bucketHeaders[3]]: "",
      Unapplied: "",
      "Open Amount": invoice.openInBase,
      "Open Amount in Currency": invoice.openInCurrency,
      "Total Amount": invoice.totalAmount,
      Settled: invoice.settled,
      "Exchange Rate": invoice.exchangeRate
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
      "Row Type": "Counterparty",
      "Counterparty Type": counterpartyType,
      "Counterparty ID": partyId,
      "Payment Term": agingRow.paymentTerm ?? "",
      "Invoice ID": "",
      "Invoice Number": "",
      "Document Type": "",
      "Due Date": "",
      Currency: "",
      Current: agingRow.current,
      [bucketHeaders[0]]: agingRow.bucket1,
      [bucketHeaders[1]]: agingRow.bucket2,
      [bucketHeaders[2]]: agingRow.bucket3,
      [bucketHeaders[3]]: agingRow.bucket4,
      Unapplied: agingRow.unapplied,
      "Open Amount": agingRow.total,
      "Open Amount in Currency": "",
      "Total Amount": "",
      Settled: "",
      "Exchange Rate": ""
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
