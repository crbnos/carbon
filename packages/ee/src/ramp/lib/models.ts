import { round } from "@carbon/utils";
import { z } from "zod";

/**
 * Zod schemas for the Ramp Developer API v1 objects Carbon consumes.
 *
 * Every schema is `.passthrough()` on purpose: Ramp evolves its payloads
 * additively and Carbon parses-never-trusts — we validate only the fields we
 * read and carry the rest through untouched. Field names follow the research
 * file (§Answers Q1); anything not yet confirmed against a live sandbox is
 * marked `TODO(task-1)`.
 */

// /********************************************************\
// *                   Monetary values                     *
// \********************************************************/

/**
 * Ramp `CurrencyAmount` — an integer number of the currency's MINOR units
 * (cents for USD, whole yen for JPY) plus the ISO currency code.
 */
export const RampCurrencyAmountSchema = z
  .object({
    amount: z.number().int(),
    currency_code: z.string()
  })
  .passthrough();

export type RampCurrencyAmount = z.infer<typeof RampCurrencyAmountSchema>;

/**
 * Convert a minor-unit integer amount to a major-unit decimal number, rounded
 * at the currency's own decimal places. `decimals` is the authoritative
 * `currency.decimalPlaces` value passed in by the caller — NEVER a literal, and
 * the division goes through the shared precision `round()` (never a bare `/` at
 * a call site). `fromMinorUnits(4000, "USD", 2) === 40`,
 * `fromMinorUnits(63, "JPY", 0) === 63`.
 */
export function fromMinorUnits(
  amount: number,
  _currencyCode: string,
  decimals: number
): number {
  return round(amount / 10 ** decimals, decimals);
}

// /********************************************************\
// *              Coding (accounting fields)                *
// \********************************************************/

/**
 * A coding selection on a transaction / line / bill — the customer's choice of
 * a Carbon account, cost center, etc. `external_id` is the Carbon-side id we
 * pushed (account.id, costCenter.id); `type` distinguishes GL_ACCOUNT from
 * COST_CENTER and the rest.
 */
export const RampAccountingCategoryInfoSchema = z
  .object({
    external_id: z.string().nullish(),
    id: z.string().nullish(),
    name: z.string().nullish(),
    // The accounting-field TYPE lives HERE per the Ramp OpenAPI spec
    // (`ApiTransactionAccountingCategoryInfo.type`: GL_ACCOUNT / COST_CENTER /
    // …), NOT on the selection itself. Verified against
    // docs.ramp.com/openapi/developer-api.json (2026-08-28).
    type: z.string().optional()
  })
  .passthrough();

export const RampAccountingFieldSelectionSchema = z
  .object({
    id: z.string().optional(),
    // `external_id` is the Carbon-side id we pushed as the field OPTION
    // (account.id / costCenter.id) — this part matches the spec.
    external_id: z.string().nullish(),
    // Legacy/top-level `type` — kept for resilience but the spec puts the type
    // under `category_info.type` (see schema above). `codeSelections` reads
    // `category_info.type` first, then falls back here.
    type: z.string().optional(),
    name: z.string().nullish(),
    category_info: RampAccountingCategoryInfoSchema.optional()
  })
  .passthrough();

export type RampAccountingFieldSelection = z.infer<
  typeof RampAccountingFieldSelectionSchema
>;

export const RampLineItemSchema = z
  .object({
    // TODO(task-1): confirm line_item amount is a CurrencyAmount (minor units)
    // vs a bare decimal number.
    amount: z.union([RampCurrencyAmountSchema, z.number()]).optional(),
    memo: z.string().nullish(),
    accounting_field_selections: z
      .array(RampAccountingFieldSelectionSchema)
      .optional()
  })
  .passthrough();

export type RampLineItem = z.infer<typeof RampLineItemSchema>;

// /********************************************************\
// *                   Transactions                         *
// \********************************************************/

export const RampCardHolderSchema = z
  .object({
    first_name: z.string().nullish(),
    last_name: z.string().nullish()
  })
  .passthrough();

/**
 * `ApiSignedAmount` (Ramp OpenAPI): `{ currency, value }` where `value` is a
 * SIGNED integer in the currency's smallest denomination (cents for USD).
 * Distinct from `RampCurrencyAmount` (`{ amount, currency_code }`) — the newer
 * transaction endpoints return `entity_amount` / `merchant_amount` as this
 * shape. Verified against docs.ramp.com/openapi/developer-api.json (2026-08-28).
 */
export const RampSignedAmountSchema = z
  .object({
    value: z.number().int(),
    currency: z.string().optional()
  })
  .passthrough();

export type RampSignedAmount = z.infer<typeof RampSignedAmountSchema>;

export const RampTransactionSchema = z
  .object({
    id: z.string(),
    state: z.string().optional(),
    sync_status: z.string().optional(),
    // DEPRECATED per the Ramp spec ("Use `entity_amount`") and it is a bare
    // `number` in MAJOR units (dollars), not minor units. Consumers must prefer
    // `entity_amount.value` (signed integer cents) below; `amount` is kept only
    // as a last-resort fallback. Verified 2026-08-28 against the OpenAPI spec.
    amount: z.number().optional(),
    // The settlement amount to the entity — signed integer in minor units
    // (cents). This is the field ramp-sync should read for card transactions.
    entity_amount: RampSignedAmountSchema.nullish(),
    // The amount the merchant originally charged — signed integer minor units.
    merchant_amount: RampSignedAmountSchema.nullish(),
    currency_code: z.string().optional(),
    currency: z.string().optional(),
    merchant_name: z.string().nullish(),
    merchant_id: z.string().nullish(),
    card_holder: RampCardHolderSchema.nullish(),
    card_id: z.string().nullish(),
    memo: z.string().nullish(),
    user_transaction_time: z.string().nullish(),
    accounting_date: z.string().nullish(),
    settlement_date: z.string().nullish(),
    entity_id: z.string().nullish(),
    original_transaction_id: z.string().nullish(),
    statement_id: z.string().nullish(),
    receipts: z.array(z.string()).optional(),
    accounting_field_selections: z
      .array(RampAccountingFieldSelectionSchema)
      .optional(),
    line_items: z.array(RampLineItemSchema).optional()
  })
  .passthrough();

export type RampTransaction = z.infer<typeof RampTransactionSchema>;

// /********************************************************\
// *                  Bills & payments                      *
// \********************************************************/

export const RampBillPaymentSchema = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    payment_method: z.string().nullish(),
    effective_date: z.string().nullish(),
    payment_date: z.string().nullish(),
    amount: z.union([RampCurrencyAmountSchema, z.number()]).optional()
  })
  .passthrough();

export type RampBillPayment = z.infer<typeof RampBillPaymentSchema>;

export const RampBillSchema = z
  .object({
    id: z.string(),
    status: z.string().optional(),
    approval_status: z.string().optional(),
    sync_status: z.string().optional(),
    remote_id: z.string().nullish(),
    invoice_number: z.string().nullish(),
    deep_link_url: z.string().nullish(),
    issued_at: z.string().nullish(),
    due_at: z.string().nullish(),
    currency_code: z.string().optional(),
    entity_id: z.string().nullish(),
    purchase_order_ids: z.array(z.string()).optional(),
    invoice_urls: z.array(z.string()).optional(),
    payment: RampBillPaymentSchema.nullish(),
    vendor: z.unknown().optional(),
    line_items: z.array(RampLineItemSchema).optional()
  })
  .passthrough();

export type RampBill = z.infer<typeof RampBillSchema>;

// /********************************************************\
// *          Transfers / cashbacks / repayments            *
// \********************************************************/

export const RampTransferSchema = z
  .object({
    id: z.string(),
    status: z.string().optional(),
    sync_status: z.string().optional(),
    amount: z.union([RampCurrencyAmountSchema, z.number()]).optional(),
    currency_code: z.string().optional(),
    bank_account_id: z.string().nullish(),
    statement_id: z.string().nullish(),
    entity_id: z.string().nullish(),
    created_at: z.string().nullish()
  })
  .passthrough();

export type RampTransfer = z.infer<typeof RampTransferSchema>;

export const RampCashbackSchema = z
  .object({
    id: z.string(),
    sync_status: z.string().optional(),
    amount: z.union([RampCurrencyAmountSchema, z.number()]).optional(),
    currency_code: z.string().optional(),
    statement_id: z.string().nullish(),
    entity_id: z.string().nullish(),
    created_at: z.string().nullish()
  })
  .passthrough();

export type RampCashback = z.infer<typeof RampCashbackSchema>;

export const RampReimbursementSchema = z
  .object({
    id: z.string(),
    state: z.string().optional(),
    sync_status: z.string().optional(),
    amount: z.union([RampCurrencyAmountSchema, z.number()]).optional(),
    currency_code: z.string().optional(),
    transaction_date: z.string().nullish(),
    approved_at: z.string().nullish(),
    entity_id: z.string().nullish(),
    user_id: z.string().nullish(),
    user: z.unknown().optional(),
    line_items: z.array(RampLineItemSchema).optional()
  })
  .passthrough();

export type RampReimbursement = z.infer<typeof RampReimbursementSchema>;

export const RampRepaymentSchema = z
  .object({
    id: z.string(),
    status: z.string().optional(),
    repaid_at: z.string().nullish(),
    original_transaction_id: z.string().nullish(),
    funding_method: z.string().nullish(),
    // TODO(task-1): confirm the repayment amount field name/shape.
    repayment_amount: z
      .union([RampCurrencyAmountSchema, z.number()])
      .optional(),
    amount: z.union([RampCurrencyAmountSchema, z.number()]).optional(),
    currency_code: z.string().optional(),
    entity_id: z.string().nullish()
  })
  .passthrough();

export type RampRepayment = z.infer<typeof RampRepaymentSchema>;

// /********************************************************\
// *            Vendors / POs / entities                    *
// \********************************************************/

export const RampVendorSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    accounting_vendor_remote_id: z.string().nullish(),
    entity_id: z.string().nullish()
  })
  .passthrough();

export type RampVendor = z.infer<typeof RampVendorSchema>;

export const RampPurchaseOrderSchema = z
  .object({
    id: z.string(),
    remote_id: z.string().nullish(),
    creation_source: z.string().optional(),
    billing_status: z.string().optional(),
    receipt_status: z.string().optional(),
    entity_id: z.string().nullish(),
    line_items: z.array(z.unknown()).optional()
  })
  .passthrough();

export type RampPurchaseOrder = z.infer<typeof RampPurchaseOrderSchema>;

export const RampEntitySchema = z
  .object({
    id: z.string(),
    entity_name: z.string().nullish(),
    name: z.string().nullish()
  })
  .passthrough();

export type RampEntity = z.infer<typeof RampEntitySchema>;

export const RampAccountingConnectionSchema = z
  .object({
    id: z.string().optional(),
    connection_id: z.string().optional(),
    remote_provider_name: z.string().nullish(),
    status: z.string().optional()
  })
  .passthrough();

export type RampAccountingConnection = z.infer<
  typeof RampAccountingConnectionSchema
>;

// /********************************************************\
// *               Webhooks / sync results                  *
// \********************************************************/

export const RampWebhookEventSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    created_at: z.string().optional(),
    business_id: z.string().optional(),
    object: z.unknown().optional()
  })
  .passthrough();

export type RampWebhookEvent = z.infer<typeof RampWebhookEventSchema>;

export const RampSyncResultSchema = z
  .object({
    id: z.string().optional(),
    sync_type: z.string().optional(),
    // Ramp echoes back the per-object success/failure of a POST /accounting/syncs.
    successful_syncs: z.array(z.unknown()).optional(),
    failed_syncs: z.array(z.unknown()).optional()
  })
  .passthrough();

export type RampSyncResult = z.infer<typeof RampSyncResultSchema>;

// /********************************************************\
// *                    Credentials                         *
// \********************************************************/

export const RampEnvironmentSchema = z.enum(["production", "sandbox"]);
export type RampEnvironment = z.infer<typeof RampEnvironmentSchema>;

export const RampCredentialsSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("client_credentials"),
      clientId: z.string(),
      clientSecret: z.string(),
      environment: RampEnvironmentSchema
    })
    .passthrough(),
  z
    .object({
      type: z.literal("oauth2"),
      accessToken: z.string(),
      refreshToken: z.string().optional(),
      expiresAt: z.string().optional(),
      environment: RampEnvironmentSchema
    })
    .passthrough()
]);

export type RampCredentials = z.infer<typeof RampCredentialsSchema>;

// /********************************************************\
// *                Integration metadata                    *
// \********************************************************/

export const RampSyncFlagsSchema = z
  .object({
    pullTransactions: z.boolean().default(true),
    pullBills: z.boolean().default(true),
    pullReimbursements: z.boolean().default(true),
    pushPurchaseOrders: z.boolean().default(true),
    pushInvoices: z.boolean().default(true)
  })
  .default({});

export type RampSyncFlags = z.infer<typeof RampSyncFlagsSchema>;

export const RampCursorsSchema = z
  .object({
    repaymentsRepaidAt: z.string().optional(),
    purchaseOrderPushUpdatedAt: z.string().optional(),
    invoicePushUpdatedAt: z.string().optional()
  })
  .optional();

export type RampCursors = z.infer<typeof RampCursorsSchema>;

/**
 * The settings form persists the five sync toggles as FLAT string flags at the
 * metadata root (`pullTransactions: "true" | "false"`, …), but the runtime reads
 * them as the nested boolean `sync` object above. This is the single place that
 * bridges the two: an explicit `"false"`/`false` disables a family; anything else
 * — including an absent flag on a fresh OAuth install — leaves it ON, matching
 * the schema default. Applied on every read, so all runtime `metadata.sync.*`
 * gates stay correct without the form and the sync engine agreeing on a shape.
 */
function flatSyncFlagEnabled(
  raw: Record<string, unknown>,
  key: string
): boolean {
  const value = raw[key];
  return value !== "false" && value !== false;
}

export const RampIntegrationMetadataSchema = z
  .object({
    credentials: RampCredentialsSchema,
    cardLiabilityAccountId: z.string().optional(),
    statementBankAccountId: z.string().optional(),
    cashbackIncomeAccountId: z.string().optional(),
    reimbursementBankAccountId: z.string().optional(),
    entityId: z.string().optional(),
    connectionId: z.string().optional(),
    webhookId: z.string().optional(),
    webhookSecret: z.string().optional(),
    cursors: RampCursorsSchema,
    sync: RampSyncFlagsSchema
  })
  .passthrough()
  .transform((m) => {
    const raw = m as Record<string, unknown>;
    return {
      ...m,
      sync: {
        pullTransactions: flatSyncFlagEnabled(raw, "pullTransactions"),
        pullBills: flatSyncFlagEnabled(raw, "pullBills"),
        pullReimbursements: flatSyncFlagEnabled(raw, "pullReimbursements"),
        pushPurchaseOrders: flatSyncFlagEnabled(raw, "pushPurchaseOrders"),
        pushInvoices: flatSyncFlagEnabled(raw, "pushInvoices")
      }
    };
  });

export type RampIntegrationMetadata = z.infer<
  typeof RampIntegrationMetadataSchema
>;
