import { z } from "zod";

/**
 * QuickBooks Online API entity schemas. Field sets are deliberately limited
 * to what the syncers map — QBO objects carry many more fields, and zod
 * strips unknown keys on parse. Reads (`query`, GET by id) return the full
 * shape including `Id`/`SyncToken`; create payloads omit them (`SyncToken`
 * is QBO's optimistic-concurrency token — every sparse update must echo the
 * latest value back).
 */
export namespace Qbo {
  /** Reference to another QBO entity, e.g. `{ value: "42", name: "Sales" }`. */
  export const RefSchema = z.object({
    value: z.string(),
    name: z.string().optional()
  });

  export type Ref = z.infer<typeof RefSchema>;

  export const MetaDataSchema = z.object({
    CreateTime: z.string().optional(),
    LastUpdatedTime: z.string()
  });

  export type MetaData = z.infer<typeof MetaDataSchema>;

  export const EmailAddressSchema = z.object({
    Address: z.string().optional()
  });

  export type EmailAddress = z.infer<typeof EmailAddressSchema>;

  export const TelephoneNumberSchema = z.object({
    FreeFormNumber: z.string().optional()
  });

  export type TelephoneNumber = z.infer<typeof TelephoneNumberSchema>;

  export const PhysicalAddressSchema = z.object({
    Id: z.string().optional(),
    Line1: z.string().optional(),
    Line2: z.string().optional(),
    City: z.string().optional(),
    /** State/province/region, e.g. "CA". */
    CountrySubDivisionCode: z.string().optional(),
    Country: z.string().optional(),
    PostalCode: z.string().optional()
  });

  export type PhysicalAddress = z.infer<typeof PhysicalAddressSchema>;

  /**
   * QBO Customer. `DisplayName` is unique across the shared name namespace
   * (customers, vendors and employees together).
   */
  export const CustomerSchema = z.object({
    Id: z.string(),
    SyncToken: z.string(),
    DisplayName: z.string(),
    PrimaryEmailAddr: EmailAddressSchema.optional(),
    PrimaryPhone: TelephoneNumberSchema.optional(),
    BillAddr: PhysicalAddressSchema.optional(),
    Active: z.boolean().optional(),
    MetaData: MetaDataSchema.optional()
  });

  export type Customer = z.infer<typeof CustomerSchema>;

  /** QBO Vendor — same field set as Customer (separate object in QBO). */
  export const VendorSchema = z.object({
    Id: z.string(),
    SyncToken: z.string(),
    DisplayName: z.string(),
    PrimaryEmailAddr: EmailAddressSchema.optional(),
    PrimaryPhone: TelephoneNumberSchema.optional(),
    BillAddr: PhysicalAddressSchema.optional(),
    Active: z.boolean().optional(),
    MetaData: MetaDataSchema.optional()
  });

  export type Vendor = z.infer<typeof VendorSchema>;

  /**
   * QBO Item. Carbon only ever writes `Service` or `NonInventory` — never
   * `Inventory` (QBO item-level tracking stays off; double-COGS guard).
   */
  export const ItemSchema = z.object({
    Id: z.string(),
    SyncToken: z.string(),
    /** QBO caps item names at 100 characters. */
    Name: z.string().max(100),
    Description: z.string().optional(),
    Type: z.enum(["Service", "NonInventory"]),
    Active: z.boolean().optional(),
    UnitPrice: z.number().optional(),
    PurchaseCost: z.number().optional(),
    IncomeAccountRef: RefSchema.optional(),
    ExpenseAccountRef: RefSchema.optional(),
    MetaData: MetaDataSchema.optional()
  });

  export type Item = z.infer<typeof ItemSchema>;

  export const SalesItemLineDetailSchema = z.object({
    ItemRef: RefSchema.optional(),
    Qty: z.number().optional(),
    UnitPrice: z.number().optional()
  });

  export type SalesItemLineDetail = z.infer<typeof SalesItemLineDetailSchema>;

  /**
   * Invoice line. `DetailType` stays a plain string because pulled invoices
   * include lines Carbon never writes (e.g. `SubTotalLineDetail`).
   */
  export const InvoiceLineSchema = z.object({
    Id: z.string().optional(),
    LineNum: z.number().optional(),
    Description: z.string().optional(),
    Amount: z.number(),
    DetailType: z.string(),
    SalesItemLineDetail: SalesItemLineDetailSchema.optional()
  });

  export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

  export const InvoiceSchema = z.object({
    Id: z.string(),
    SyncToken: z.string(),
    /** QBO caps DocNumber at 21 characters. */
    DocNumber: z.string().optional(),
    TxnDate: z.string().optional(), // YYYY-MM-DD
    DueDate: z.string().optional(),
    CustomerRef: RefSchema,
    Line: z.array(InvoiceLineSchema),
    TotalAmt: z.number().optional(),
    Balance: z.number().optional(),
    PrivateNote: z.string().optional(),
    MetaData: MetaDataSchema.optional()
  });

  export type Invoice = z.infer<typeof InvoiceSchema>;

  export const AccountBasedExpenseLineDetailSchema = z.object({
    AccountRef: RefSchema
  });

  export type AccountBasedExpenseLineDetail = z.infer<
    typeof AccountBasedExpenseLineDetailSchema
  >;

  export const ItemBasedExpenseLineDetailSchema = z.object({
    ItemRef: RefSchema.optional(),
    Qty: z.number().optional(),
    UnitPrice: z.number().optional()
  });

  export type ItemBasedExpenseLineDetail = z.infer<
    typeof ItemBasedExpenseLineDetailSchema
  >;

  /**
   * Expense-style line shared by Bill and PurchaseOrder: item lines carry
   * `ItemBasedExpenseLineDetail`, non-item lines carry
   * `AccountBasedExpenseLineDetail` with the mapped account.
   */
  export const ExpenseLineSchema = z.object({
    Id: z.string().optional(),
    LineNum: z.number().optional(),
    Description: z.string().optional(),
    Amount: z.number(),
    DetailType: z.string(),
    AccountBasedExpenseLineDetail:
      AccountBasedExpenseLineDetailSchema.optional(),
    ItemBasedExpenseLineDetail: ItemBasedExpenseLineDetailSchema.optional()
  });

  export type ExpenseLine = z.infer<typeof ExpenseLineSchema>;

  export const BillSchema = z.object({
    Id: z.string(),
    SyncToken: z.string(),
    DocNumber: z.string().optional(),
    TxnDate: z.string().optional(),
    DueDate: z.string().optional(),
    VendorRef: RefSchema,
    Line: z.array(ExpenseLineSchema),
    /** ISO-4217 currency ref (`{ value: "EUR" }`) — set on FX bills. */
    CurrencyRef: RefSchema.optional(),
    /** Foreign→home exchange rate — set on FX bills (omitted at rate 1). */
    ExchangeRate: z.number().optional(),
    TotalAmt: z.number().optional(),
    Balance: z.number().optional(),
    PrivateNote: z.string().optional(),
    MetaData: MetaDataSchema.optional()
  });

  export type Bill = z.infer<typeof BillSchema>;

  export const PurchaseOrderSchema = z.object({
    Id: z.string(),
    SyncToken: z.string(),
    DocNumber: z.string().optional(),
    TxnDate: z.string().optional(),
    VendorRef: RefSchema,
    /** Email address the PO is sent to (supplier's primary contact). */
    POEmail: EmailAddressSchema.optional(),
    Line: z.array(ExpenseLineSchema),
    POStatus: z.enum(["Open", "Closed"]).optional(),
    TotalAmt: z.number().optional(),
    PrivateNote: z.string().optional(),
    MetaData: MetaDataSchema.optional()
  });

  export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

  /**
   * A settled transaction referenced by a payment line. QBO BillPayment lines
   * carry `LinkedTxn[{ TxnId, TxnType:"Bill" }]`; Payment lines carry
   * `TxnType:"Invoice"`. Only the id + type are used (to resolve the Carbon
   * bill/invoice via the mapping table).
   */
  export const LinkedTxnSchema = z.object({
    TxnId: z.string(),
    TxnType: z.string(),
    TxnLineId: z.string().optional()
  });

  export type LinkedTxn = z.infer<typeof LinkedTxnSchema>;

  /**
   * A single application line on a Payment / BillPayment: `Amount` is the
   * amount applied to the linked document(s). `LinkedTxn` is normally a single
   * Bill/Invoice per line, but is modeled as an array (QBO's wire shape).
   */
  export const PaymentLineSchema = z.object({
    Amount: z.number().optional(),
    LinkedTxn: z.array(LinkedTxnSchema).optional()
  });

  export type PaymentLine = z.infer<typeof PaymentLineSchema>;

  /**
   * QBO Payment (Accounts Receivable): a customer payment applied to one or
   * more Invoices via `Line[].LinkedTxn{TxnType:"Invoice"}`. Lenient — only the
   * fields the payment syncer maps are modeled; QBO returns many more.
   */
  export const PaymentSchema = z.object({
    Id: z.string(),
    SyncToken: z.string().optional(),
    TxnDate: z.string().optional(), // YYYY-MM-DD
    TotalAmt: z.number().optional(),
    CurrencyRef: RefSchema.optional(),
    ExchangeRate: z.number().optional(),
    CustomerRef: RefSchema.optional(),
    PrivateNote: z.string().optional(),
    Line: z.array(PaymentLineSchema).optional(),
    MetaData: MetaDataSchema.optional()
  });

  export type Payment = z.infer<typeof PaymentSchema>;

  /**
   * QBO BillPayment (Accounts Payable): a vendor payment applied to one or more
   * Bills via `Line[].LinkedTxn{TxnType:"Bill"}`. Same lenient contract as
   * PaymentSchema.
   */
  export const BillPaymentSchema = z.object({
    Id: z.string(),
    SyncToken: z.string().optional(),
    TxnDate: z.string().optional(),
    TotalAmt: z.number().optional(),
    CurrencyRef: RefSchema.optional(),
    ExchangeRate: z.number().optional(),
    VendorRef: RefSchema.optional(),
    PrivateNote: z.string().optional(),
    Line: z.array(PaymentLineSchema).optional(),
    MetaData: MetaDataSchema.optional()
  });

  export type BillPayment = z.infer<typeof BillPaymentSchema>;

  export const JournalEntryLineDetailSchema = z.object({
    /** QBO journal lines are unsigned; the side lives here. */
    PostingType: z.enum(["Debit", "Credit"]),
    AccountRef: RefSchema,
    /** Dimension slot target "class" (QBO Class entity). */
    ClassRef: RefSchema.optional(),
    /** Dimension slot target "department" (QBO Department entity). */
    DepartmentRef: RefSchema.optional()
  });

  export type JournalEntryLineDetail = z.infer<
    typeof JournalEntryLineDetailSchema
  >;

  export const JournalEntryLineSchema = z.object({
    Id: z.string().optional(),
    Description: z.string().optional(),
    /** Always positive — direction comes from PostingType. */
    Amount: z.number(),
    DetailType: z.literal("JournalEntryLineDetail"),
    JournalEntryLineDetail: JournalEntryLineDetailSchema
  });

  export type JournalEntryLine = z.infer<typeof JournalEntryLineSchema>;

  export const JournalEntrySchema = z.object({
    Id: z.string(),
    SyncToken: z.string(),
    DocNumber: z.string().optional(),
    TxnDate: z.string().optional(),
    PrivateNote: z.string().optional(),
    Line: z.array(JournalEntryLineSchema),
    MetaData: MetaDataSchema.optional()
  });

  export type JournalEntry = z.infer<typeof JournalEntrySchema>;

  /**
   * QBO Class — the class-tracking analytics entity journal lines
   * reference via `JournalEntryLineDetail.ClassRef`. Feature-gated by the
   * Intuit plan; orgs without class tracking reject the query.
   */
  export const ClassSchema = z.object({
    Id: z.string(),
    SyncToken: z.string(),
    Name: z.string(),
    FullyQualifiedName: z.string().optional(),
    Active: z.boolean().optional(),
    MetaData: MetaDataSchema.optional()
  });

  export type Class = z.infer<typeof ClassSchema>;

  /** QBO Department (a.k.a. Location) — referenced via `DepartmentRef`. */
  export const DepartmentSchema = z.object({
    Id: z.string(),
    SyncToken: z.string(),
    Name: z.string(),
    FullyQualifiedName: z.string().optional(),
    Active: z.boolean().optional(),
    MetaData: MetaDataSchema.optional()
  });

  export type Department = z.infer<typeof DepartmentSchema>;

  /**
   * Chart-of-accounts entry. `AcctNum` is optional in QBO — the account
   * mapping falls back to `Id` when no number is assigned.
   */
  export const AccountSchema = z.object({
    Id: z.string(),
    Name: z.string(),
    AcctNum: z.string().optional(),
    AccountType: z.string(),
    /** "Asset" | "Liability" | "Equity" | "Revenue" | "Expense" */
    Classification: z.string().optional(),
    Active: z.boolean().optional()
  });

  export type Account = z.infer<typeof AccountSchema>;

  /** Company profile returned by GET /companyinfo/{realmId}. */
  export const CompanyInfoSchema = z.object({
    Id: z.string(),
    SyncToken: z.string().optional(),
    CompanyName: z.string(),
    LegalName: z.string().optional(),
    Country: z.string().optional(),
    MetaData: MetaDataSchema.optional()
  });

  export type CompanyInfo = z.infer<typeof CompanyInfoSchema>;
}

/**
 * Fields every persisted QBO entity carries. Reads return them; write
 * payloads treat them per QboCreatePayload/QboUpdatePayload below.
 */
export type QboEntityFields = {
  Id: string;
  SyncToken: string;
  MetaData?: Qbo.MetaData;
};

/**
 * Create payload: QBO assigns Id/SyncToken/MetaData, so a create POST body
 * omits them.
 */
export type QboCreatePayload<T extends QboEntityFields> = Omit<
  T,
  "Id" | "SyncToken" | "MetaData"
>;

/**
 * Update payload: QBO's optimistic concurrency requires echoing the current
 * SyncToken with the target Id; MetaData stays server-owned. Updates are
 * sent sparse (only the provided fields change).
 */
export type QboUpdatePayload<T extends QboEntityFields> = QboCreatePayload<T> &
  Pick<T, "Id" | "SyncToken">;

/**
 * Parse a QBO MetaData timestamp (ISO 8601 with offset, e.g.
 * "2026-07-01T13:07:59-07:00"). Returns null for missing/invalid values.
 */
export function parseQboDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
