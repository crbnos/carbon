import { z } from "zod";

/**
 * Rillet API entity schemas (API version 4, pinned in provider.ts). Field
 * sets are deliberately limited to what the syncers map — Rillet objects
 * carry more fields, and zod strips unknown keys on parse. Reads (GET by
 * id, list endpoints) return the full shape including `id`/`updated_at`;
 * write payloads omit the server-owned fields (see RilletWriteOmit below).
 *
 * Conventions that differ from QBO/Xero:
 * - Money is `{ amount: "1000.00", currency: "USD" }` — the amount is a
 *   2-dp DECIMAL STRING, not a number.
 * - Dates are plain YYYY-MM-DD strings; timestamps are ISO 8601.
 * - Journal items are UNSIGNED with an explicit `side` (DEBIT/CREDIT).
 */
export namespace Rillet {
  /** `{ amount: "1000.00", currency: "USD" }` — amount is a 2-dp string. */
  export const MonetaryAmountSchema = z.object({
    amount: z.string(),
    currency: z.string()
  });

  export type MonetaryAmount = z.infer<typeof MonetaryAmountSchema>;

  /** Carbon always writes `{ type: "carbon", id: <carbon id> }`. */
  export const ExternalReferenceSchema = z.object({
    type: z.string(),
    id: z.string(),
    url: z.string().optional()
  });

  export type ExternalReference = z.infer<typeof ExternalReferenceSchema>;

  /** Chart-of-accounts entry from GET /accounts. */
  export const AccountSchema = z.object({
    id: z.string(),
    code: z.string().nullish(),
    name: z.string().nullish(),
    /** ASSET | LIABILITY | EQUITY | EXPENSE | INCOME — kept lenient. */
    type: z.string().nullish(),
    subtype: z.string().nullish(),
    /** ACTIVE | INACTIVE — only ACTIVE accounts are offered for mapping. */
    status: z.string().nullish(),
    intercompany: z.boolean().nullish(),
    updated_at: z.string().nullish()
  });

  export type Account = z.infer<typeof AccountSchema>;

  /** Entity from GET /subsidiaries (Rillet is multi-entity). */
  export const SubsidiarySchema = z.object({
    id: z.string(),
    name: z.string().nullish()
  });

  export type Subsidiary = z.infer<typeof SubsidiarySchema>;

  export const RelatedEntitySchema = z.object({
    id: z.string(),
    type: z.enum(["CUSTOMER", "VENDOR"])
  });

  export type RelatedEntity = z.infer<typeof RelatedEntitySchema>;

  /**
   * One pick-list value of a Rillet Field (GET /fields → fields[].values).
   * `id` is the uuid journal/bill/invoice items reference via
   * `fields[].field_value_id`.
   */
  export const FieldValueSchema = z.object({
    id: z.string(),
    name: z.string(),
    deactivated: z.boolean().nullish()
  });

  export type FieldValue = z.infer<typeof FieldValueSchema>;

  /**
   * A Rillet Field definition (verified v4 surface, 2026-08-04): the
   * dimension-native analytics field. `settings` describes applicability
   * per area (EXPENSES = bills/manual entries; REVENUE = customers/
   * contracts/invoices/credit memos) with `{ mandatory, display }` where
   * display is STANDALONE (single-select) or FREE_TAG — kept lenient.
   */
  export const FieldSchema = z.object({
    id: z.string(),
    name: z.string(),
    values: z.array(FieldValueSchema).default([]),
    settings: z.record(z.string(), z.unknown()).nullish(),
    updated_at: z.string().nullish()
  });

  export type Field = z.infer<typeof FieldSchema>;

  /**
   * Field reference on a journal/bill/invoice item: uuid pairs, never
   * names (`fields: [{ field_id, field_value_id }]`).
   */
  export const ItemFieldRefSchema = z.object({
    field_id: z.string(),
    field_value_id: z.string()
  });

  export type ItemFieldRef = z.infer<typeof ItemFieldRefSchema>;

  /** Journal item: unsigned money + explicit side (unlike Xero's signed lines). */
  export const JournalEntryItemSchema = z.object({
    /** Server-assigned on reads. */
    id: z.string().optional(),
    /** Server-resolved from account_code on reads. */
    account_id: z.string().optional(),
    account_code: z.string(),
    amount: MonetaryAmountSchema,
    side: z.enum(["DEBIT", "CREDIT"]),
    description: z.string().optional(),
    vat_code: z.string().optional(),
    vat_type: z.string().optional(),
    /** Dimension refs (Rillet Fields) — uuid pairs. */
    fields: z.array(ItemFieldRefSchema).optional()
  });

  export type JournalEntryItem = z.infer<typeof JournalEntryItemSchema>;

  export const JournalEntrySchema = z.object({
    id: z.string(),
    name: z.string(),
    /** YYYY-MM-DD. */
    date: z.string(),
    /** ISO-4217. */
    currency: z.string(),
    /** Rillet requires >= 2 balanced items. */
    items: z.array(JournalEntryItemSchema).min(2),
    subsidiary_id: z.string().optional(),
    related_entity: RelatedEntitySchema.optional(),
    reversal_date: z.string().optional(),
    exchange_rate: z.number().optional(),
    updated_at: z.string().optional()
  });

  export type JournalEntry = z.infer<typeof JournalEntrySchema>;

  /**
   * Rillet addresses are an all-or-nothing group: line1/city/state/
   * zip_code/country must all be present (line2 optional).
   */
  export const AddressSchema = z.object({
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    state: z.string(),
    zip_code: z.string(),
    country: z.string()
  });

  export type Address = z.infer<typeof AddressSchema>;

  export const CustomerEmailSchema = z.object({
    email: z.string(),
    type: z.enum(["MAIN_SENDER", "CC", "BCC"])
  });

  export type CustomerEmail = z.infer<typeof CustomerEmailSchema>;

  export const CustomerSchema = z.object({
    id: z.string(),
    name: z.string(),
    name_on_invoice: z.string().nullish(),
    address: AddressSchema.optional(),
    shipping_address: AddressSchema.optional(),
    emails: z.array(CustomerEmailSchema).optional(),
    external_references: z.array(ExternalReferenceSchema).optional(),
    /** Days, integer >= 0. */
    payment_terms: z.number().int().optional(),
    send_invoices_automatically: z.boolean().optional(),
    send_payment_reminders: z.boolean().optional(),
    updated_at: z.string().optional()
  });

  export type Customer = z.infer<typeof CustomerSchema>;

  export const VendorSchema = z.object({
    id: z.string(),
    name: z.string(),
    /** Default expense account code for the vendor's bills. */
    account_code: z.string().nullish(),
    address: AddressSchema.optional(),
    email: z.string().nullish(),
    /** Days, 0-180. */
    payment_terms: z.number().int().optional(),
    external_references: z.array(ExternalReferenceSchema).optional(),
    ten_ninety_nine_eligible: z.boolean().optional(),
    tax_id: z.string().nullish(),
    updated_at: z.string().optional()
  });

  export type Vendor = z.infer<typeof VendorSchema>;

  /**
   * Carbon only ever writes ONE_TIME prices (Rillet also supports
   * FIXED_RECURRING and USAGE; Carbon-generated AR_ONLY invoices carry
   * their own line totals, so the product price is nominal).
   */
  export const ProductPriceSchema = z.object({
    type: z.literal("ONE_TIME"),
    amount: MonetaryAmountSchema
  });

  export type ProductPrice = z.infer<typeof ProductPriceSchema>;

  /** Rillet caps product names at 250 characters. */
  export const ProductSchema = z.object({
    id: z.string(),
    name: z.string().max(250),
    description: z.string(),
    price: ProductPriceSchema,
    include_in_arr_mrr: z.boolean(),
    revenue_pattern: z.enum(["DAILY", "EVEN_PERIOD"]),
    /** Revenue account in Rillet's chart of accounts. */
    account_code: z.string(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    external_references: z.array(ExternalReferenceSchema).optional(),
    updated_at: z.string().optional()
  });

  export type Product = z.infer<typeof ProductSchema>;

  /** AR_ONLY invoice item — product_id is REQUIRED on every line. */
  export const InvoiceItemSchema = z.object({
    id: z.string().optional(),
    product_id: z.string(),
    description: z.string(),
    quantity: z.number(),
    total_amount: MonetaryAmountSchema,
    tax_amount: MonetaryAmountSchema.optional(),
    external_references: z.array(ExternalReferenceSchema).min(1)
  });

  export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;

  /**
   * AR_ONLY invoice: Carbon keeps generating/sending the invoice; Rillet
   * carries the receivable. `invoice_number` is Carbon's readable id.
   */
  export const InvoiceSchema = z.object({
    id: z.string(),
    scope: z.literal("AR_ONLY"),
    customer_id: z.string(),
    /** YYYY-MM-DD. */
    invoice_date: z.string(),
    invoice_number: z.string(),
    /** Defaults to invoice_date when omitted. */
    due_date: z.string().optional(),
    tax_amount: MonetaryAmountSchema.optional(),
    subsidiary_id: z.string().optional(),
    exchange_rate: z.number().optional(),
    items: z.array(InvoiceItemSchema).min(1),
    external_references: z.array(ExternalReferenceSchema).min(1),
    status: z.string().optional(),
    updated_at: z.string().optional()
  });

  export type Invoice = z.infer<typeof InvoiceSchema>;

  export const BillItemSchema = z.object({
    id: z.string().optional(),
    account_code: z.string(),
    amount: MonetaryAmountSchema,
    description: z.string().optional(),
    tax_rate: z.number().optional(),
    fields: z.array(ItemFieldRefSchema).optional()
  });

  export type BillItem = z.infer<typeof BillItemSchema>;

  export const BillStatusSchema = z.enum([
    "UNPAID",
    "PAID",
    "PARTIALLY_PAID",
    "CREDITED",
    "PARTIALLY_CREDITED",
    "APPLIED"
  ]);

  export type BillStatus = z.infer<typeof BillStatusSchema>;

  export const BillSchema = z.object({
    id: z.string(),
    vendor_id: z.string(),
    /** Carbon's readable purchase-invoice id. */
    expense_number: z.string(),
    bill_date: z.string(),
    /** REQUIRED by Rillet (unlike Carbon, where dateDue can be null). */
    due_date: z.string(),
    items: z.array(BillItemSchema).min(1),
    subsidiary_id: z.string().optional(),
    impact_date: z.string().optional(),
    external_references: z.array(ExternalReferenceSchema).optional(),
    exchange_rate: z.number().optional(),
    status: BillStatusSchema.optional(),
    updated_at: z.string().optional()
  });

  export type Bill = z.infer<typeof BillSchema>;

  /**
   * Payment status union across BOTH sources: the list endpoint
   * (GET /invoices/{id}/payments → SUCCESSFUL | FAILED | UNCLEARED) and
   * the invoice-payment-updated webhook (UNCLEARED | CLEARED | RECONCILED
   * | FAILED). Anything except FAILED settles the invoice.
   */
  export const InvoicePaymentStatusSchema = z.enum([
    "SUCCESSFUL",
    "FAILED",
    "UNCLEARED",
    "CLEARED",
    "RECONCILED"
  ]);

  export type InvoicePaymentStatus = z.infer<typeof InvoicePaymentStatusSchema>;

  /**
   * One invoice payment. Accepts both wire shapes: the list endpoint
   * carries `amount: { amount, currency }` + `date`/`account_code`; the
   * webhook payload carries a flat `amount` + `currency` +
   * `payment_date`/`cash_account_code`. Use getRilletPaymentAmount /
   * getRilletPaymentCurrency (entities/payment.ts) to normalize.
   */
  export const InvoicePaymentSchema = z.object({
    id: z.string(),
    status: InvoicePaymentStatusSchema,
    invoice_id: z.string().optional(),
    amount: z.union([MonetaryAmountSchema, z.string(), z.number()]).optional(),
    currency: z.string().optional(),
    date: z.string().optional(),
    payment_date: z.string().optional(),
    account_code: z.string().optional(),
    cash_account_code: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional()
  });

  export type InvoicePayment = z.infer<typeof InvoicePaymentSchema>;

  /**
   * One bill payment (AP mirror of InvoicePayment). Read from
   * `GET /bills/{billId}/payments` and the org-wide `GET /bill-payments`
   * feed. Same amount/currency/date wire shapes as invoice payments; the
   * parent link is `bill_id` (not `invoice_id`).
   *
   * VERIFY: the bill-payment status vocabulary is not confirmed against the
   * live Rillet OpenAPI, so `status` is kept lenient (a bare string) — only
   * "FAILED" reverses a recorded payment; anything else settles, mirroring
   * the invoice-payment rule (Anything except FAILED settles).
   */
  export const BillPaymentSchema = z.object({
    id: z.string(),
    status: z.string(),
    bill_id: z.string().optional(),
    amount: z.union([MonetaryAmountSchema, z.string(), z.number()]).optional(),
    currency: z.string().optional(),
    date: z.string().optional(),
    payment_date: z.string().optional(),
    account_code: z.string().optional(),
    cash_account_code: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional()
  });

  export type BillPayment = z.infer<typeof BillPaymentSchema>;
}

/** Server-owned fields every Rillet write payload omits. */
export type RilletWriteOmit = "id" | "updated_at";

/** Transaction documents additionally carry a server-owned status. */
export type RilletTransactionWriteOmit = RilletWriteOmit | "status";

export type RilletJournalEntryCreate = Omit<
  Rillet.JournalEntry,
  RilletWriteOmit
>;
export type RilletCustomerWrite = Omit<Rillet.Customer, RilletWriteOmit>;
export type RilletVendorWrite = Omit<Rillet.Vendor, RilletWriteOmit>;
export type RilletProductWrite = Omit<Rillet.Product, RilletWriteOmit>;
export type RilletInvoiceCreate = Omit<
  Rillet.Invoice,
  RilletTransactionWriteOmit
>;
export type RilletBillCreate = Omit<Rillet.Bill, RilletTransactionWriteOmit>;

/**
 * Create payload for a Rillet payment recorded against one document
 * (`POST /invoices/{id}/payments` for AR, `POST /bills/{id}/payments` for AP —
 * the parent document is in the path). Used by the Phase G outbound payment
 * write-back for Carbon-born payments (e.g. a bill paid through Ramp).
 *
 * VERIFY: neither the create endpoints/paths nor the exact field names are
 * confirmed against the live Rillet OpenAPI (no local spec exists). The shape
 * mirrors the READ schemas (InvoicePaymentSchema / BillPaymentSchema) —
 * `amount` as a MonetaryAmount, an ISO `date`, and the cash/bank
 * `account_code` — plus the Carbon external reference. If a field is wrong,
 * the create 400s and the sync operation lands Failed (visible, not silent).
 */
export type RilletPaymentCreate = {
  amount: Rillet.MonetaryAmount;
  /** YYYY-MM-DD. VERIFIED (sandbox 2026-08-11): the create endpoints take
   * `date`, not `payment_date` — the latter 400s with "date must not be
   * null". */
  date: string;
  /** Rillet cash/bank account code the payment clears through. */
  account_code: string;
  /** Carbon payment id, tagged like every other pushed document. */
  external_references?: Rillet.ExternalReference[];
};

/**
 * Local shape of a pulled Rillet invoice payment. Core has no
 * Accounting.Payment schema yet, so the payment syncer's TLocal stays
 * provider-local: it describes what upsertLocal writes into the Carbon
 * `payment` + `invoiceSettlement` tables, not a core contract.
 */
export type RilletLocalPayment = {
  /** Composite sync entity id — see getRilletPaymentSyncEntityId. */
  id: string;
  invoiceRemoteId: string;
  paymentRemoteId: string;
  amount: number;
  currencyCode: string | null;
  /** YYYY-MM-DD. */
  date: string;
  status: Rillet.InvoicePaymentStatus;
  updatedAt: string;
};

/**
 * Parse a Rillet timestamp (ISO 8601). Returns null for missing/invalid
 * values — same contract as parseQboDate.
 */
export function parseRilletDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
