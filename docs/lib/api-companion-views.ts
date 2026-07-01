/**
 * Mapping of tables that have a companion view with computed columns.
 *
 * When a table has stored columns (subtotal, totalTax, totalAmount, balance,
 * status) that are only correct in the companion view — because the view
 * computes them live from line items and settlements — we surface a callout
 * directing API consumers to use the view for reads and the table for writes.
 *
 * Key: table name (singular), Value: view name (plural)
 */
export const TABLE_VIEW_COMPANIONS: Record<
  string,
  { viewTable: string; viewSlug: string; viewModule: string }
> = {
  salesInvoice: {
    viewTable: "salesInvoices",
    viewSlug: "sales-invoices",
    viewModule: "invoicing",
  },
  purchaseInvoice: {
    viewTable: "purchaseInvoices",
    viewSlug: "purchase-invoices",
    viewModule: "invoicing",
  },
};

/**
 * Reverse lookup: view → table
 */
export const VIEW_TABLE_COMPANIONS: Record<
  string,
  { tableTable: string; tableSlug: string; tableModule: string }
> = {
  salesInvoices: {
    tableTable: "salesInvoice",
    tableSlug: "sales-invoice",
    tableModule: "invoicing",
  },
  purchaseInvoices: {
    tableTable: "purchaseInvoice",
    tableSlug: "purchase-invoice",
    tableModule: "invoicing",
  },
};
