import { csvIdentifier } from "../../../accounting/ui/Reports/exportReport";

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
  labels?: Partial<ARAPAgingExportLabels>;
};

export type ARAPAgingExportLabels = {
  asOfDate: string;
  side: string;
  agingMethod: string;
  bucketDays: string;
  baseCurrency: string;
  rowType: string;
  counterpartyType: string;
  counterpartyId: string;
  paymentTerm: string;
  invoiceId: string;
  invoiceNumber: string;
  documentType: string;
  dueDate: string;
  currency: string;
  currentBaseCurrency: string;
  unappliedBaseCurrency: string;
  openAmountBaseCurrency: string;
  openAmountInvoiceCurrency: string;
  totalAmountInvoiceCurrency: string;
  settledInvoiceCurrency: string;
  exchangeRateInvoiceToBase: string;
  counterpartyRow: string;
  invoiceRow: string;
  customer: string;
  supplier: string;
  dueDateMethod: string;
  documentDateMethod: string;
};

const defaultLabels: ARAPAgingExportLabels = {
  asOfDate: "As Of Date",
  side: "Side",
  agingMethod: "Aging Method",
  bucketDays: "Bucket Days",
  baseCurrency: "Base Currency",
  rowType: "Row Type",
  counterpartyType: "Counterparty Type",
  counterpartyId: "Counterparty ID",
  paymentTerm: "Payment Term",
  invoiceId: "Invoice ID",
  invoiceNumber: "Invoice Number",
  documentType: "Document Type",
  dueDate: "Due Date",
  currency: "Currency",
  currentBaseCurrency: "Current (Base Currency)",
  unappliedBaseCurrency: "Unapplied (Base Currency)",
  openAmountBaseCurrency: "Open Amount (Base Currency)",
  openAmountInvoiceCurrency: "Open Amount (Invoice Currency)",
  totalAmountInvoiceCurrency: "Total Amount (Invoice Currency)",
  settledInvoiceCurrency: "Settled (Invoice Currency)",
  exchangeRateInvoiceToBase: "Exchange Rate (Invoice to Base)",
  counterpartyRow: "Counterparty",
  invoiceRow: "Invoice",
  customer: "Customer",
  supplier: "Supplier",
  dueDateMethod: "dueDate",
  documentDateMethod: "documentDate"
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
  bucketDays,
  labels: labelOverrides
}: ARAPAgingExportArgs): Record<string, unknown>[] {
  const labels = { ...defaultLabels, ...labelOverrides };
  const [b1, b2, b3] = bucketDays;
  const bucketHeaders = [
    `1-${b1}`,
    `${b1 + 1}-${b2}`,
    `${b2 + 1}-${b3}`,
    `${b3 + 1}+`
  ];
  const sideLabel = side.toUpperCase();
  const agingMethodLabel =
    agingMethod === "dueDate"
      ? labels.dueDateMethod
      : labels.documentDateMethod;
  const counterpartyType = side === "ar" ? labels.customer : labels.supplier;
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
      [labels.asOfDate]: asOfDate,
      [labels.side]: sideLabel,
      [labels.agingMethod]: agingMethodLabel,
      [labels.bucketDays]: bucketDays.join(","),
      [labels.baseCurrency]: baseCurrencyCode,
      [labels.rowType]: labels.invoiceRow,
      [labels.counterpartyType]: counterpartyType,
      [labels.counterpartyId]: csvIdentifier(partyIdOf(side, invoice)),
      [labels.paymentTerm]: "",
      [labels.invoiceId]: csvIdentifier(invoice.invoiceId),
      [labels.invoiceNumber]: csvIdentifier(invoice.invoiceNumber),
      [labels.documentType]: invoice.documentType ?? "",
      [labels.dueDate]: invoice.dateDue ?? "",
      [labels.currency]: invoice.currencyCode,
      [labels.currentBaseCurrency]: "",
      [`${bucketHeaders[0]} (${labels.baseCurrency})`]: "",
      [`${bucketHeaders[1]} (${labels.baseCurrency})`]: "",
      [`${bucketHeaders[2]} (${labels.baseCurrency})`]: "",
      [`${bucketHeaders[3]} (${labels.baseCurrency})`]: "",
      [labels.unappliedBaseCurrency]: "",
      [labels.openAmountBaseCurrency]: invoice.openInBase,
      [labels.openAmountInvoiceCurrency]: invoice.openInCurrency,
      [labels.totalAmountInvoiceCurrency]: invoice.totalAmount,
      [labels.settledInvoiceCurrency]: invoice.settled,
      [labels.exchangeRateInvoiceToBase]: invoice.exchangeRate
    });
  };

  const groupedPartyIds = new Set<string>();
  for (const agingRow of aging) {
    const partyId = partyIdOf(side, agingRow);
    if (!partyId) continue;
    groupedPartyIds.add(partyId);
    rows.push({
      [labels.asOfDate]: asOfDate,
      [labels.side]: sideLabel,
      [labels.agingMethod]: agingMethodLabel,
      [labels.bucketDays]: bucketDays.join(","),
      [labels.baseCurrency]: baseCurrencyCode,
      [labels.rowType]: labels.counterpartyRow,
      [labels.counterpartyType]: counterpartyType,
      [labels.counterpartyId]: csvIdentifier(partyId),
      [labels.paymentTerm]: agingRow.paymentTerm ?? "",
      [labels.invoiceId]: "",
      [labels.invoiceNumber]: "",
      [labels.documentType]: "",
      [labels.dueDate]: "",
      [labels.currency]: baseCurrencyCode,
      [labels.currentBaseCurrency]: agingRow.current,
      [`${bucketHeaders[0]} (${labels.baseCurrency})`]: agingRow.bucket1,
      [`${bucketHeaders[1]} (${labels.baseCurrency})`]: agingRow.bucket2,
      [`${bucketHeaders[2]} (${labels.baseCurrency})`]: agingRow.bucket3,
      [`${bucketHeaders[3]} (${labels.baseCurrency})`]: agingRow.bucket4,
      [labels.unappliedBaseCurrency]: agingRow.unapplied,
      [labels.openAmountBaseCurrency]: agingRow.total,
      [labels.openAmountInvoiceCurrency]: "",
      [labels.totalAmountInvoiceCurrency]: "",
      [labels.settledInvoiceCurrency]: "",
      [labels.exchangeRateInvoiceToBase]: ""
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
  isSourceComplete: boolean,
  rowCount: number
): boolean {
  return !dataError && isSourceComplete && rowCount > 0;
}
