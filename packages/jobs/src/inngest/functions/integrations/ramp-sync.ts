/**
 * Ramp inbound sync — one Inngest function per company that drains every Ramp
 * accounting family that is "ready to sync", turns each item into a Carbon
 * `cardTransaction`, posts it through the `post-card-transaction` edge function,
 * and confirms the result back to Ramp (`POST /accounting/syncs`).
 *
 * FAMILY-FAILURE ISOLATION (lessons.md): each family runs in its own `step.run`
 * wrapped in try/catch. One family's listing failure must never abort the
 * others, nor discard another family's already-collected confirms — a family
 * confirms whatever it managed to gather even if its own drain threw partway.
 *
 * Idempotency: an already-synced Ramp item is detected via its
 * `externalIntegrationMapping` (`cardTransaction` entityType) and re-confirmed
 * only — never re-created. A `mapping.link(...)` is written before the item is
 * confirmed, so a retry (SYNC_READY still lists the item until Ramp records the
 * confirm) short-circuits on the mapping instead of duplicating.
 *
 * Task 7 covers the card families (transactions, transfers, cashbacks). Tasks
 * 8–10 add bills / reimbursements / repayments / outbound as their own
 * `step.run` blocks in this same function.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { createMappingService } from "@carbon/ee/accounting";
import {
  advanceRampCursor,
  archiveRampBillForInvoice,
  confirmSyncs,
  fromMinorUnits,
  getRampIntegration,
  pushInvoiceDraftBill,
  pushPurchaseOrder,
  type RampBill,
  type RampBillPayment,
  type RampCashback,
  type RampClient,
  type RampCurrencyAmount,
  type RampIntegrationMetadata,
  type RampLineItem,
  type RampReimbursement,
  type RampRepayment,
  type RampTransaction,
  type RampTransfer,
  type RampVendorSupplier,
  resolveEmployeeSupplier,
  resolveRampSupplier,
  scaleLinesToTotal,
  scaleRepaymentLines
} from "@carbon/ee/ramp.server";
import { getAppUrl } from "@carbon/env";
import { trigger } from "@carbon/lib/trigger";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

type CarbonClient = SupabaseClient<Database>;

/** Ramp accounting-field-selection `type` for a coded GL account. */
const GL_ACCOUNT = "GL_ACCOUNT";
// TODO(task-1): confirm Ramp's cost-center field selection `type` (the custom
// `carbon-cost-center` SINGLE_CHOICE field pushed in service.pushCostCenters).
const COST_CENTER = "COST_CENTER";

/** The card-transactions list route (jobs can't import ~/utils/path). */
const CARD_TRANSACTIONS_PATH = "/x/invoicing/card-transactions";

/** The purchase-invoice detail route (jobs can't import ~/utils/path). */
const PURCHASE_INVOICE_PATH = "/x/purchase-invoice";

/**
 * Ramp bill `payment.payment_method` values that mean the bill was paid with a
 * Ramp card — these route through card accounting (the card-transaction sync),
 * so we confirm the payment WITHOUT posting an AP payment against the invoice.
 */
// TODO(task-1): confirm Ramp's card payment_method enum values.
const CARD_PAYMENT_METHODS = new Set([
  "CARD",
  "ONE_TIME_CARD",
  "AUTOMATIC_CARD_PAYMENT"
]);

/** Ramp bill status that means the bill has been fully paid. */
// TODO(task-1): confirm Ramp's paid bill status string.
const BILL_PAID_STATUS = "PAID";

/**
 * Reimbursement `state` values that mean Ramp itself paid out the employee — so
 * Carbon posts the AP payment that closes the reimbursement invoice. An APPROVED
 * (but not-yet-paid / manual-payout) reimbursement leaves the invoice Open.
 */
// TODO(task-1): confirm the reimbursement state that distinguishes Ramp-paid
// from manual-payout (REIMBURSED vs APPROVED), and whether payment fields carry
// the payout instant.
const REIMBURSEMENT_PAID_STATES = new Set(["REIMBURSED", "PAID", "PAID_OUT"]);

/** Repayment `status` that means the employee has actually repaid. */
// TODO(task-1): confirm the repayment REPAID status string.
const REPAYMENT_REPAID_STATUS = "REPAID";

/**
 * Repayment `funding_method` value that means the repayment was applied as a
 * statement credit (offsetting the card liability) rather than deposited to the
 * statement bank account.
 */
// TODO(task-1): confirm the repayment funding_method enum values.
const REPAYMENT_STATEMENT_CREDIT_FUNDING = "STATEMENT_CREDIT";

/** How many candidate PO / invoice rows the outbound step drains per run. */
const OUTBOUND_PAGE_SIZE = 100;

/**
 * Purchase-order statuses eligible to push to Ramp — the complement of the ones
 * the plan excludes (`Draft`, `Needs Approval`, `Rejected`, `Planned`). Completed
 * and Closed are included so a mapped PO can be archived; released statuses push.
 */
const PO_PUSH_STATUSES: Database["public"]["Enums"]["purchaseOrderStatus"][] = [
  "To Review",
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed",
  "Closed"
];

/** Purchase-invoice view-statuses eligible to push as a Ramp draft bill. */
const INVOICE_PUSH_STATUSES = ["Open", "Partially Paid"];

/** Purchase-invoice view-statuses that mean a pushed bill can be archived. */
const INVOICE_SETTLED_STATUSES = new Set(["Paid", "Voided"]);

type SyncItem = { id: string; referenceId: string; deepLinkUrl?: string };
type FailItem = { id: string; message: string };
type FamilyResult = { created: number; reconfirmed: number; failed: number };

/**
 * Shared per-run context: the service-role client, the mapping service, and the
 * lazily-cached company scope (currency decimals + document groups).
 */
type Ctx = {
  client: CarbonClient;
  /** The Kysely handle the mapping service is built over (reused by service helpers). */
  db: ReturnType<typeof getJobDatabaseClient>;
  mapping: ReturnType<typeof createMappingService>;
  companyId: string;
  metadata: RampIntegrationMetadata;
  baseCurrency: string;
  companyGroupId: string | null;
  decimalsCache: Map<string, number>;
  exchangeRateCache: Map<string, number>;
};

/**
 * Resolve a coded GL account + cost center from a Ramp accounting-field-selection
 * list. The first GL_ACCOUNT selection wins for the account; the first
 * COST_CENTER selection wins for the cost center. `external_id` is the Carbon id
 * Carbon pushed (account.id / costCenter.id).
 */
function codeSelections(
  selections:
    | Array<{
        external_id?: string | null;
        type?: string;
        category_info?: { type?: string } | null;
      }>
    | null
    | undefined
): { accountId: string | null; costCenterId: string | null } {
  let accountId: string | null = null;
  let costCenterId: string | null = null;
  for (const selection of selections ?? []) {
    if (!selection.external_id) continue;
    // The field TYPE is at `category_info.type` per the Ramp OpenAPI spec
    // (verified 2026-08-28); the legacy top-level `type` is only a fallback.
    // Reading `selection.type` alone left this always-undefined, so no line
    // ever resolved an account/cost-center — every line failed "uncoded".
    const fieldType = selection.category_info?.type ?? selection.type;
    if (fieldType === GL_ACCOUNT && !accountId) {
      accountId = selection.external_id;
    } else if (fieldType === COST_CENTER && !costCenterId) {
      costCenterId = selection.external_id;
    }
  }
  return { accountId, costCenterId };
}

function deepLinkUrl(): string {
  return `${getAppUrl()}${CARD_TRANSACTIONS_PATH}`;
}

function invoiceDeepLinkUrl(invoiceRowId: string): string {
  return `${getAppUrl()}${PURCHASE_INVOICE_PATH}/${invoiceRowId}`;
}

/**
 * Extract the integer minor-unit amount from a Ramp money value. Handles both
 * money shapes the API returns: `CurrencyAmount` (`{ amount }`) and
 * `ApiSignedAmount` (`{ value }`, used by transaction `entity_amount` /
 * `merchant_amount`). A bare number is assumed already-minor (legacy callers).
 */
function toMinorUnits(
  value:
    | number
    | RampCurrencyAmount
    | { value: number; currency?: string }
    | null
    | undefined
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if ("value" in value && typeof value.value === "number") return value.value;
  if ("amount" in value && typeof value.amount === "number")
    return value.amount;
  return null;
}

async function getDecimals(ctx: Ctx, currencyCode: string): Promise<number> {
  const cached = ctx.decimalsCache.get(currencyCode);
  if (cached !== undefined) return cached;

  let decimals = 2;
  if (ctx.companyGroupId) {
    const { data } = await ctx.client
      .from("currency")
      .select("decimalPlaces")
      .eq("companyGroupId", ctx.companyGroupId)
      .eq("code", currencyCode)
      .maybeSingle();
    if (data?.decimalPlaces != null) decimals = data.decimalPlaces;
  }
  ctx.decimalsCache.set(currencyCode, decimals);
  return decimals;
}

/**
 * Resolve the exchange rate (transaction currency -> company base currency) for a
 * card transaction. Base currency is 1; otherwise the company's stored
 * `currency.exchangeRate` (the same current rate every Carbon document uses — see
 * the quote sync in `paperless-parts.ts`). A non-base transaction with no known
 * rate falls back to 1 rather than blocking the sync.
 */
async function getExchangeRate(
  ctx: Ctx,
  currencyCode: string
): Promise<number> {
  if (currencyCode === ctx.baseCurrency) return 1;
  const cached = ctx.exchangeRateCache.get(currencyCode);
  if (cached !== undefined) return cached;

  let rate = 1;
  if (ctx.companyGroupId) {
    const { data } = await ctx.client
      .from("currency")
      .select("exchangeRate")
      .eq("companyGroupId", ctx.companyGroupId)
      .eq("code", currencyCode)
      .maybeSingle();
    if (data?.exchangeRate != null) rate = data.exchangeRate;
  }
  ctx.exchangeRateCache.set(currencyCode, rate);
  return rate;
}

/** A supplier row with its purchasing contact + a location's address embedded. */
type SupplierVendorRow = {
  id: string;
  name: string | null;
  supplierTypeId: string | null;
  supplierContact: {
    contact: {
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      mobilePhone: string | null;
      homePhone: string | null;
      workPhone: string | null;
    } | null;
  } | null;
  supplierLocation: Array<{
    address: {
      countryCode: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      stateProvince: string | null;
      postalCode: string | null;
    } | null;
  }> | null;
};

/**
 * Batch-resolve suppliers with the contact + country a Ramp SPEND vendor needs
 * (option B: match-then-create). One query, never per-supplier: the purchasing
 * contact (`supplier.purchasingContactId`) supplies the required email; the first
 * location with a country supplies the required `country` (+ address). Returns a
 * map keyed by supplier id; `supplierTypeId` rides along for the invoice family's
 * employee-supplier check so it needs no second query.
 */
async function loadRampVendorSuppliers(
  ctx: Ctx,
  supplierIds: string[]
): Promise<
  Map<string, RampVendorSupplier & { supplierTypeId: string | null }>
> {
  const map = new Map<
    string,
    RampVendorSupplier & { supplierTypeId: string | null }
  >();
  const ids = [...new Set(supplierIds.filter(Boolean))];
  if (ids.length === 0) return map;

  const { data } = await ctx.client
    .from("supplier")
    .select(
      "id, name, supplierTypeId, supplierContact!supplier_purchasingContactId_fkey(contact(email, firstName, lastName, mobilePhone, homePhone, workPhone)), supplierLocation!supplierLocation_supplierId_fkey(address(countryCode, addressLine1, addressLine2, city, stateProvince, postalCode))"
    )
    .eq("companyId", ctx.companyId)
    .in("id", ids);

  for (const row of (data ?? []) as unknown as SupplierVendorRow[]) {
    const contact = row.supplierContact?.contact ?? null;
    const addresses = (row.supplierLocation ?? [])
      .map((location) => location.address)
      .filter((address): address is NonNullable<typeof address> =>
        Boolean(address)
      );
    const address =
      addresses.find((candidate) => candidate.countryCode) ??
      addresses[0] ??
      null;

    map.set(row.id, {
      id: row.id,
      name: row.name,
      supplierTypeId: row.supplierTypeId ?? null,
      country: address?.countryCode ?? null,
      contact: contact
        ? {
            email: contact.email ?? null,
            firstName: contact.firstName ?? null,
            lastName: contact.lastName ?? null,
            phone:
              contact.mobilePhone ??
              contact.workPhone ??
              contact.homePhone ??
              null
          }
        : null,
      address: address
        ? {
            line1: address.addressLine1 ?? null,
            line2: address.addressLine2 ?? null,
            city: address.city ?? null,
            stateProvince: address.stateProvince ?? null,
            postalCode: address.postalCode ?? null
          }
        : null
    });
  }
  return map;
}

/** A bare supplier fallback when its details row is missing. */
function emptyRampVendorSupplier(
  id: string,
  name: string | null
): RampVendorSupplier {
  return { id, name, country: null, contact: null, address: null };
}

/**
 * Ramp requires an `entity_id` on a PO create. Prefer the configured
 * `metadata.entityId`; otherwise resolve the business's first entity (the common
 * single-entity case). Returns undefined only when neither is available.
 */
async function resolveRampEntityId(
  metadata: RampIntegrationMetadata,
  ramp: RampClient
): Promise<string | undefined> {
  if (metadata.entityId) return metadata.entityId;
  try {
    const res = await ramp.getEntities<{
      data?: Array<{ id?: string }>;
    }>();
    return res.data?.[0]?.id;
  } catch {
    return undefined;
  }
}

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

function documentTypeForFile(
  fileName: string
): Database["public"]["Enums"]["documentType"] {
  const ext = extension(fileName);
  if (ext === "pdf") return "PDF";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext))
    return "Image";
  return "Other";
}

// Mirror of ~/utils/string stripSpecialCharacters (app-only, not importable).
function stripSpecialCharacters(input: string): string {
  return input.replace(/[^a-zA-Z0-9/!_\-.*'() &$@=;:+,?]/g, "");
}

/**
 * Download and attach a card transaction's Ramp receipts to the private bucket
 * + a `document` row. Non-fatal by contract — any failure is logged and
 * skipped so a missing receipt never blocks the sync.
 */
async function attachReceipts(
  ctx: Ctx,
  args: {
    cardTransactionId: string;
    receiptIds: string[];
    getReceipt: (id: string) => Promise<unknown>;
  }
): Promise<void> {
  if (args.receiptIds.length === 0) return;

  const companyGroups = ctx.companyGroupId ? [ctx.companyGroupId] : [];

  for (const receiptId of args.receiptIds) {
    try {
      const receipt = (await args.getReceipt(receiptId)) as {
        receipt_url?: string;
        file_name?: string;
      } | null;
      const url = receipt?.receipt_url;
      if (!url) continue;

      const response = await fetch(url);
      if (!response.ok) {
        console.error(
          `[RAMP SYNC] ${ctx.companyId}: receipt ${receiptId} download failed (${response.status})`
        );
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const name = stripSpecialCharacters(
        receipt.file_name ?? `receipt-${receiptId}`
      );
      const path = `${ctx.companyId}/card-transaction/${args.cardTransactionId}/${name}`;

      const uploaded = await ctx.client.storage
        .from("private")
        .upload(path, bytes, { upsert: true });
      if (uploaded.error) {
        console.error(
          `[RAMP SYNC] ${ctx.companyId}: receipt ${receiptId} upload failed`,
          uploaded.error
        );
        continue;
      }

      const inserted = await ctx.client.from("document").insert({
        path,
        name,
        size: bytes.byteLength,
        type: documentTypeForFile(name),
        sourceDocumentId: args.cardTransactionId,
        companyId: ctx.companyId,
        createdBy: "system",
        readGroups: companyGroups,
        writeGroups: companyGroups
      });
      if (inserted.error) {
        console.error(
          `[RAMP SYNC] ${ctx.companyId}: receipt ${receiptId} document insert failed`,
          inserted.error
        );
      }
    } catch (receiptError) {
      console.error(
        `[RAMP SYNC] ${ctx.companyId}: receipt ${receiptId} attach threw`,
        receiptError
      );
    }
  }
}

type BuiltLine = {
  accountId: string;
  amount: number;
  costCenterId: string | null;
  description: string | null;
};

/**
 * Build the Carbon `cardTransactionLine` rows from a Ramp transaction's coding.
 * Returns an error message when any line is uncoded — the caller creates
 * nothing in that case.
 */
async function buildTransactionLines(
  ctx: Ctx,
  tx: RampTransaction,
  currencyCode: string,
  decimals: number,
  headerAmount: number
): Promise<{ lines: BuiltLine[] } | { error: string }> {
  const uncoded =
    "Line is coded to an account Carbon doesn't recognize — recode the transaction";

  const lines: BuiltLine[] = [];

  if (tx.line_items && tx.line_items.length > 0) {
    for (const item of tx.line_items) {
      const { accountId, costCenterId } = codeSelections(
        item.accounting_field_selections
      );
      if (!accountId) return { error: uncoded };
      const minor = toMinorUnits(item.amount);
      const amount =
        minor === null
          ? 0
          : fromMinorUnits(Math.abs(minor), currencyCode, decimals);
      lines.push({
        accountId,
        amount,
        costCenterId,
        description: item.memo ?? null
      });
    }
  } else {
    const { accountId, costCenterId } = codeSelections(
      tx.accounting_field_selections
    );
    if (!accountId) return { error: uncoded };
    lines.push({
      accountId,
      amount: headerAmount,
      costCenterId,
      description: tx.memo ?? null
    });
  }

  // Ramp line-item amounts are in the MERCHANT currency; the header amount is
  // the SETTLEMENT amount (`entity_amount`). For a foreign transaction the two
  // differ, so the raw lines would not sum to the header and
  // post-card-transaction (lines must sum to the header) would reject the whole
  // charge. Scale the lines to the settlement header, residual on the largest
  // line — a no-op for a same-currency transaction (ratio ≈ 1, residual 0).
  const settledLines = scaleLinesToTotal(lines, headerAmount, decimals);

  // Verify every coded account really exists in this company's group (one
  // query). `account` (chart of accounts) is scoped by companyGroupId, NOT
  // companyId — it has no companyId column, so filtering by it errored and made
  // EVERY coded card transaction fail "Failed to verify accounts". The ids come
  // from Ramp coding (the account.id Carbon pushed), so scoping to the group is
  // both correct and tenant-safe.
  const accountIds = [...new Set(settledLines.map((line) => line.accountId))];
  let accountQuery = ctx.client
    .from("account")
    .select("id")
    .in("id", accountIds);
  if (ctx.companyGroupId) {
    accountQuery = accountQuery.eq("companyGroupId", ctx.companyGroupId);
  }
  const { data: accounts, error } = await accountQuery;
  if (error) {
    return { error: `Failed to verify accounts: ${error.message}` };
  }
  const known = new Set((accounts ?? []).map((row) => row.id));
  if (accountIds.some((id) => !known.has(id))) {
    return { error: uncoded };
  }

  return { lines: settledLines };
}

/**
 * Create a Draft `cardTransaction` (+ lines), post it through the edge
 * function, link the mapping, and attach receipts. Returns the confirm item on
 * success or a failure message. Creates NOTHING on a pre-post failure; deletes
 * the Draft row on a post failure.
 */
async function createAndPostTransaction(
  ctx: Ctx,
  args: {
    rampId: string;
    type: Database["public"]["Enums"]["cardTransactionType"];
    amount: number;
    currencyCode: string;
    transactionDate: string;
    postingDate: string | null;
    cardAccountId: string;
    offsetAccountId: string | null;
    merchantName: string | null;
    cardHolderName: string | null;
    memo: string | null;
    lines: BuiltLine[];
    receiptIds: string[];
    getReceipt: (id: string) => Promise<unknown>;
  }
): Promise<{ ok: SyncItem } | { fail: FailItem }> {
  const seq = await ctx.client.rpc("get_next_sequence", {
    sequence_name: "cardTransaction",
    company_id: ctx.companyId
  });
  if (seq.error || !seq.data) {
    return {
      fail: {
        id: args.rampId,
        message: `Failed to generate card transaction number: ${
          seq.error?.message ?? "unknown error"
        }`
      }
    };
  }
  const readableId = seq.data as string;

  const exchangeRate = await getExchangeRate(ctx, args.currencyCode);

  const header = await ctx.client
    .from("cardTransaction")
    .insert({
      cardTransactionId: readableId,
      type: args.type,
      status: "Draft",
      integration: "ramp",
      cardAccountId: args.cardAccountId,
      offsetAccountId: args.offsetAccountId,
      merchantName: args.merchantName,
      cardHolderName: args.cardHolderName,
      memo: args.memo,
      transactionDate: args.transactionDate,
      postingDate: args.postingDate,
      currencyCode: args.currencyCode,
      exchangeRate,
      amount: args.amount,
      companyId: ctx.companyId,
      createdBy: "system"
    })
    .select("id")
    .single();
  if (header.error || !header.data) {
    return {
      fail: {
        id: args.rampId,
        message: `Failed to create card transaction: ${
          header.error?.message ?? "unknown error"
        }`
      }
    };
  }
  const cardTransactionId = header.data.id;

  if (args.lines.length > 0) {
    const lineRows = await ctx.client.from("cardTransactionLine").insert(
      args.lines.map((line, index) => ({
        cardTransactionId,
        companyId: ctx.companyId,
        accountId: line.accountId,
        costCenterId: line.costCenterId,
        description: line.description,
        amount: line.amount,
        sequence: index,
        createdBy: "system"
      }))
    );
    if (lineRows.error) {
      // FK is ON DELETE CASCADE — deleting the header removes any partial lines.
      await ctx.client
        .from("cardTransaction")
        .delete()
        .eq("id", cardTransactionId)
        .eq("companyId", ctx.companyId);
      return {
        fail: {
          id: args.rampId,
          message: `Failed to create card transaction lines: ${lineRows.error.message}`
        }
      };
    }
  }

  const posted = await ctx.client.functions.invoke("post-card-transaction", {
    body: {
      type: "post",
      cardTransactionId,
      userId: "system",
      companyId: ctx.companyId
    }
  });
  if (posted.error) {
    await ctx.client
      .from("cardTransaction")
      .delete()
      .eq("id", cardTransactionId)
      .eq("companyId", ctx.companyId);
    const message =
      posted.error instanceof Error
        ? posted.error.message
        : String(posted.error);
    return { fail: { id: args.rampId, message } };
  }

  await ctx.mapping.link(
    "cardTransaction",
    cardTransactionId,
    "ramp",
    args.rampId,
    { createdBy: "system" }
  );

  await attachReceipts(ctx, {
    cardTransactionId,
    receiptIds: args.receiptIds,
    getReceipt: args.getReceipt
  });

  return {
    ok: { id: args.rampId, referenceId: readableId, deepLinkUrl: deepLinkUrl() }
  };
}

/** Look up readable ids for already-mapped Ramp items (one query). */
async function reconfirmMapped(
  ctx: Ctx,
  mapped: Array<{ rampId: string; entityId: string }>
): Promise<SyncItem[]> {
  if (mapped.length === 0) return [];
  const entityIds = [...new Set(mapped.map((m) => m.entityId))];
  const { data } = await ctx.client
    .from("cardTransaction")
    .select("id, cardTransactionId")
    .eq("companyId", ctx.companyId)
    .in("id", entityIds);
  const readableById = new Map(
    (data ?? []).map((row) => [row.id, row.cardTransactionId])
  );
  const url = deepLinkUrl();
  return mapped.map((m) => ({
    id: m.rampId,
    referenceId: readableById.get(m.entityId) ?? m.entityId,
    deepLinkUrl: url
  }));
}

/**
 * Look up readable ids for already-mapped Ramp bills/reimbursements (one query,
 * mirroring `reconfirmMapped` for the `purchaseInvoice` id space). The deep link
 * is per-invoice, so it is built from each entity id.
 */
async function reconfirmMappedInvoices(
  ctx: Ctx,
  mapped: Array<{ rampId: string; entityId: string }>
): Promise<SyncItem[]> {
  if (mapped.length === 0) return [];
  const entityIds = [...new Set(mapped.map((m) => m.entityId))];
  const { data } = await ctx.client
    .from("purchaseInvoice")
    .select("id, invoiceId")
    .eq("companyId", ctx.companyId)
    .in("id", entityIds);
  const readableById = new Map(
    (data ?? []).map((row) => [row.id, row.invoiceId])
  );
  return mapped.map((m) => ({
    id: m.rampId,
    referenceId: readableById.get(m.entityId) ?? m.entityId,
    deepLinkUrl: invoiceDeepLinkUrl(m.entityId)
  }));
}

// /********************************************************\
// *                   Bills (AP invoices)                 *
// \********************************************************/

type BuiltInvoiceLine = {
  accountId: string;
  costCenterId: string | null;
  amount: number;
  description: string | null;
};

/**
 * Extract the Ramp vendor `{ id?, name }` a bill was issued to. The bill's
 * `vendor` object shape is not yet confirmed against a live sandbox.
 */
function extractRampVendor(bill: RampBill): { id?: string; name: string } {
  // TODO(task-1): confirm the bill.vendor object shape (id / name fields).
  const vendor = bill.vendor as
    | {
        id?: string;
        name?: string;
        business_name?: string;
      }
    | null
    | undefined;
  const name =
    vendor?.name ??
    vendor?.business_name ??
    ((bill as { vendor_name?: string }).vendor_name || "");
  return { id: vendor?.id, name };
}

/**
 * Build G/L-coded invoice lines from a Ramp bill's line items. Returns an error
 * message when a line is uncoded or the coded account doesn't exist — the caller
 * creates nothing in that case.
 */
async function buildBillLines(
  ctx: Ctx,
  bill: RampBill,
  currencyCode: string,
  decimals: number
): Promise<{ lines: BuiltInvoiceLine[] } | { error: string }> {
  const uncoded =
    "Bill line is coded to an account Carbon doesn't recognize — recode the bill in Ramp";

  const items = bill.line_items ?? [];
  if (items.length === 0) {
    return { error: "Bill has no line items to post" };
  }

  const lines: BuiltInvoiceLine[] = [];
  for (const item of items) {
    const { accountId, costCenterId } = codeSelections(
      item.accounting_field_selections
    );
    if (!accountId) return { error: uncoded };
    const minor = toMinorUnits(item.amount);
    const amount =
      minor === null
        ? 0
        : fromMinorUnits(Math.abs(minor), currencyCode, decimals);
    lines.push({
      accountId,
      costCenterId,
      amount,
      description: item.memo ?? null
    });
  }

  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const { data: accounts, error } = await ctx.client
    .from("account")
    .select("id")
    .eq("companyId", ctx.companyId)
    .in("id", accountIds);
  if (error) {
    return { error: `Failed to verify accounts: ${error.message}` };
  }
  const known = new Set((accounts ?? []).map((row) => row.id));
  if (accountIds.some((id) => !known.has(id))) {
    return { error: uncoded };
  }

  return { lines };
}

/**
 * Set a Draft purchase invoice to Pending and post it through the
 * `post-purchase-invoice` edge function. Reverts to Draft on error (clone of the
 * $invoiceId.post route). Returns the readable invoice id on success.
 */
async function postPurchaseInvoice(
  ctx: Ctx,
  invoiceRowId: string
): Promise<{ readableId: string } | { fail: string }> {
  const info = await ctx.client
    .from("purchaseInvoice")
    .select("invoiceId")
    .eq("id", invoiceRowId)
    .eq("companyId", ctx.companyId)
    .single();
  const readableId = info.data?.invoiceId ?? invoiceRowId;

  const pending = await ctx.client
    .from("purchaseInvoice")
    .update({ status: "Pending" })
    .eq("id", invoiceRowId)
    .eq("companyId", ctx.companyId);
  if (pending.error) {
    return { fail: `Failed to set invoice pending: ${pending.error.message}` };
  }

  const posted = await ctx.client.functions.invoke("post-purchase-invoice", {
    body: {
      invoiceId: invoiceRowId,
      userId: "system",
      companyId: ctx.companyId
    }
  });
  if (posted.error) {
    await ctx.client
      .from("purchaseInvoice")
      .update({ status: "Draft" })
      .eq("id", invoiceRowId)
      .eq("companyId", ctx.companyId);
    const message =
      posted.error instanceof Error
        ? posted.error.message
        : String(posted.error);
    return { fail: `Failed to post invoice: ${message}` };
  }

  return { readableId };
}

/**
 * Attach a bill's `invoice_urls` PDFs to the invoice's private bucket + document
 * rows. Non-fatal by contract — any failure is logged and skipped.
 */
async function attachBillDocuments(
  ctx: Ctx,
  args: { invoiceRowId: string; urls: string[] }
): Promise<void> {
  if (args.urls.length === 0) return;
  const companyGroups = ctx.companyGroupId ? [ctx.companyGroupId] : [];

  let index = 0;
  for (const url of args.urls) {
    index += 1;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(
          `[RAMP SYNC] ${ctx.companyId}: bill document download failed (${response.status})`
        );
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const basename =
        url.split("?")[0]?.split("/").pop() || `bill-${index}.pdf`;
      const name = stripSpecialCharacters(basename);
      const path = `${ctx.companyId}/purchase-invoice/${args.invoiceRowId}/${name}`;

      const uploaded = await ctx.client.storage
        .from("private")
        .upload(path, bytes, { upsert: true });
      if (uploaded.error) {
        console.error(
          `[RAMP SYNC] ${ctx.companyId}: bill document upload failed`,
          uploaded.error
        );
        continue;
      }

      const inserted = await ctx.client.from("document").insert({
        path,
        name,
        size: bytes.byteLength,
        type: documentTypeForFile(name),
        sourceDocumentId: args.invoiceRowId,
        companyId: ctx.companyId,
        createdBy: "system",
        readGroups: companyGroups,
        writeGroups: companyGroups
      });
      if (inserted.error) {
        console.error(
          `[RAMP SYNC] ${ctx.companyId}: bill document insert failed`,
          inserted.error
        );
      }
    } catch (documentError) {
      console.error(
        `[RAMP SYNC] ${ctx.companyId}: bill document attach threw`,
        documentError
      );
    }
  }
}

/**
 * Sync one Ramp bill into Carbon as a posted purchase invoice. Returns `ok` when
 * a new invoice was created + posted, `skip` when an existing invoice was linked
 * (Carbon-born / duplicate — nothing created), or `fail`.
 */
async function syncBill(
  ctx: Ctx,
  bill: RampBill
): Promise<{ ok: SyncItem } | { skip: SyncItem } | { fail: FailItem }> {
  // Out of scope for v1: bills that apply vendor credits.
  const vendorCredits = (bill as { applied_vendor_credits?: unknown[] })
    .applied_vendor_credits;
  if (Array.isArray(vendorCredits) && vendorCredits.length > 0) {
    return {
      fail: {
        id: bill.id,
        message:
          "Bill applies vendor credits — vendor credits not supported yet"
      }
    };
  }

  // Carbon-born short-circuit: the bill's remote_id is a Carbon invoice we pushed.
  if (bill.remote_id) {
    const invoice = await ctx.client
      .from("purchaseInvoice")
      .select("id, invoiceId")
      .eq("id", bill.remote_id)
      .eq("companyId", ctx.companyId)
      .maybeSingle();
    if (invoice.data) {
      await ctx.mapping.link("bill", invoice.data.id, "ramp", bill.id, {
        createdBy: "system"
      });
      return {
        skip: {
          id: bill.id,
          referenceId: invoice.data.invoiceId,
          deepLinkUrl: invoiceDeepLinkUrl(invoice.data.id)
        }
      };
    }
  }

  // Supplier (mapping -> name -> auto-create).
  const vendor = extractRampVendor(bill);
  if (!vendor.name) {
    return {
      fail: {
        id: bill.id,
        message: "Bill has no vendor — cannot resolve a supplier"
      }
    };
  }
  let supplierId: string;
  try {
    supplierId = await resolveRampSupplier(
      ctx.client,
      ctx.companyId,
      vendor,
      "system",
      ctx.db
    );
  } catch (supplierError) {
    return {
      fail: {
        id: bill.id,
        message:
          supplierError instanceof Error
            ? supplierError.message
            : String(supplierError)
      }
    };
  }

  const invoiceNumber = (bill.invoice_number ?? "").trim();

  // Duplicate guard: same supplier + supplierReference already invoiced. Only a
  // NON-Draft (actually posted/posting) invoice counts as an already-synced
  // duplicate — a stuck Draft left behind by a prior failed post must NOT be
  // treated as synced, or we would confirm the bill to Ramp while the invoice
  // never reaches the GL.
  if (invoiceNumber) {
    const dup = await ctx.client
      .from("purchaseInvoice")
      .select("id, invoiceId")
      .eq("companyId", ctx.companyId)
      .eq("supplierId", supplierId)
      .eq("supplierReference", invoiceNumber)
      .neq("status", "Draft")
      .limit(1)
      .maybeSingle();
    if (dup.data) {
      await ctx.mapping.link("bill", dup.data.id, "ramp", bill.id, {
        createdBy: "system"
      });
      return {
        skip: {
          id: bill.id,
          referenceId: dup.data.invoiceId,
          deepLinkUrl: invoiceDeepLinkUrl(dup.data.id)
        }
      };
    }
  }

  const currencyCode = bill.currency_code ?? ctx.baseCurrency;
  const decimals = await getDecimals(ctx, currencyCode);
  const dateIssued = bill.issued_at?.slice(0, 10) ?? null;
  const dateDue = bill.due_at?.slice(0, 10) ?? null;

  // PO-linked: convert the first mapped Carbon PO into an invoice.
  const rampPoIds = bill.purchase_order_ids ?? [];
  let carbonPoId: string | null = null;
  for (const rampPoId of rampPoIds) {
    const poId = await ctx.mapping.getEntityId(
      "ramp",
      rampPoId,
      "purchaseOrder"
    );
    if (poId) {
      carbonPoId = poId;
      break;
    }
  }

  let invoiceRowId: string;

  if (carbonPoId) {
    // Retry guard: a prior sweep may have converted this PO into a Draft invoice
    // but crashed/failed before posting AND before writing the `bill` mapping.
    // Re-converting would create a SECOND invoice from the same PO (the `convert`
    // edge fn does not dedupe — it supports partial invoicing). Reuse the existing
    // unposted invoice instead. Linkage is `purchaseInvoiceLine.purchaseOrderId`.
    const candidateLines = await ctx.client
      .from("purchaseInvoiceLine")
      .select("invoiceId")
      .eq("companyId", ctx.companyId)
      .eq("purchaseOrderId", carbonPoId);
    const candidateInvoiceIds = [
      ...new Set(
        (candidateLines.data ?? [])
          .map((row) => row.invoiceId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    let reuseInvoiceId: string | null = null;
    if (candidateInvoiceIds.length > 0) {
      const draft = await ctx.client
        .from("purchaseInvoice")
        .select("id")
        .eq("companyId", ctx.companyId)
        .in("id", candidateInvoiceIds)
        .eq("status", "Draft")
        .limit(1)
        .maybeSingle();
      reuseInvoiceId = draft.data?.id ?? null;
    }

    if (reuseInvoiceId) {
      invoiceRowId = reuseInvoiceId;
    } else {
      const converted = await ctx.client.functions.invoke<{ id: string }>(
        "convert",
        {
          body: {
            type: "purchaseOrderToPurchaseInvoice",
            id: carbonPoId,
            companyId: ctx.companyId,
            userId: "system"
          }
        }
      );
      if (converted.error || !converted.data?.id) {
        const message =
          converted.error instanceof Error
            ? converted.error.message
            : String(converted.error ?? "convert returned no invoice id");
        return {
          fail: {
            id: bill.id,
            message: `Failed to convert purchase order to invoice: ${message}`
          }
        };
      }
      invoiceRowId = converted.data.id;
    }

    // Multi-PO bills post against the first mapped PO only (v1 out of scope).
    const memo =
      rampPoIds.length > 1
        ? `Ramp bill ${bill.id} spans ${rampPoIds.length} purchase orders; posted against the first mapped PO only.`
        : null;

    // TODO(task-1): reconcile the converted PO lines to the bill's line amounts
    // (match purchase_order_line_item_id). v1 keeps the PO-derived line amounts.
    const headerUpdate: Record<string, unknown> = {};
    if (invoiceNumber) headerUpdate.supplierReference = invoiceNumber;
    if (dateIssued) headerUpdate.dateIssued = dateIssued;
    if (dateDue) headerUpdate.dateDue = dateDue;
    if (memo) headerUpdate.internalNotes = { content: memo };
    if (Object.keys(headerUpdate).length > 0) {
      await ctx.client
        .from("purchaseInvoice")
        .update(headerUpdate as never)
        .eq("id", invoiceRowId)
        .eq("companyId", ctx.companyId);
    }
  } else {
    // Standalone: build G/L lines and insert a fresh Draft invoice.
    const built = await buildBillLines(ctx, bill, currencyCode, decimals);
    if ("error" in built) {
      return { fail: { id: bill.id, message: built.error } };
    }

    const interaction = await ctx.client
      .from("supplierInteraction")
      .insert([{ companyId: ctx.companyId, supplierId }])
      .select("id")
      .single();
    if (interaction.error || !interaction.data) {
      return {
        fail: {
          id: bill.id,
          message: `Failed to create supplier interaction: ${
            interaction.error?.message ?? "unknown error"
          }`
        }
      };
    }

    const seq = await ctx.client.rpc("get_next_sequence", {
      sequence_name: "purchaseInvoice",
      company_id: ctx.companyId
    });
    if (seq.error || !seq.data) {
      return {
        fail: {
          id: bill.id,
          message: `Failed to generate invoice number: ${
            seq.error?.message ?? "unknown error"
          }`
        }
      };
    }
    const readableId = seq.data as string;

    const header = await ctx.client
      .from("purchaseInvoice")
      .insert({
        invoiceId: readableId,
        status: "Draft",
        supplierId,
        supplierReference: invoiceNumber,
        currencyCode,
        dateIssued,
        dateDue,
        supplierInteractionId: interaction.data.id,
        companyId: ctx.companyId,
        createdBy: "system"
      })
      .select("id")
      .single();
    if (header.error || !header.data) {
      return {
        fail: {
          id: bill.id,
          message: `Failed to create purchase invoice: ${
            header.error?.message ?? "unknown error"
          }`
        }
      };
    }
    invoiceRowId = header.data.id;

    const lineRows = built.lines.map((line, lineIndex) => ({
      invoiceId: invoiceRowId,
      invoiceLineType: "G/L Account" as const,
      accountId: line.accountId,
      costCenterId: line.costCenterId,
      description: line.description,
      quantity: 1,
      unitPrice: line.amount,
      exchangeRate: 1,
      sortOrder: lineIndex + 1,
      companyId: ctx.companyId,
      createdBy: "system"
    }));
    const insertedLines = await ctx.client
      .from("purchaseInvoiceLine")
      .insert(lineRows);
    if (insertedLines.error) {
      // FK is ON DELETE CASCADE — deleting the header removes partial lines.
      await ctx.client
        .from("purchaseInvoice")
        .delete()
        .eq("id", invoiceRowId)
        .eq("companyId", ctx.companyId);
      return {
        fail: {
          id: bill.id,
          message: `Failed to create invoice lines: ${insertedLines.error.message}`
        }
      };
    }
  }

  const postOutcome = await postPurchaseInvoice(ctx, invoiceRowId);
  if ("fail" in postOutcome) {
    return { fail: { id: bill.id, message: postOutcome.fail } };
  }

  await ctx.mapping.link("bill", invoiceRowId, "ramp", bill.id, {
    createdBy: "system"
  });

  await attachBillDocuments(ctx, {
    invoiceRowId,
    urls: bill.invoice_urls ?? []
  });

  return {
    ok: {
      id: bill.id,
      referenceId: postOutcome.readableId,
      deepLinkUrl: invoiceDeepLinkUrl(invoiceRowId)
    }
  };
}

/**
 * Create a Draft AP `payment` + a single `invoiceSettlement` against a posted
 * purchase invoice and post it through the `post-payment` edge function (reverts
 * by deleting the draft rows on error). Shared by the bill-payments and
 * reimbursement families so their payment shape can never drift. Returns the
 * payment row id + readable id on success, or a failure message. The CALLER owns
 * the `externalIntegrationMapping` link (its id space differs per family).
 */
async function createAndPostPayment(
  ctx: Ctx,
  args: {
    supplierId: string | null;
    invoiceRowId: string;
    invoiceExchangeRate: number;
    currencyCode: string;
    amount: number;
    paymentDate: string;
    bankAccount: string;
    memo: string;
  }
): Promise<
  { paymentRowId: string; readablePaymentId: string } | { fail: string }
> {
  const seq = await ctx.client.rpc("get_next_sequence", {
    sequence_name: "payment",
    company_id: ctx.companyId
  });
  if (seq.error || !seq.data) {
    return {
      fail: `Failed to generate payment number: ${
        seq.error?.message ?? "unknown error"
      }`
    };
  }
  const readablePaymentId = seq.data as string;

  const paymentRow = await ctx.client
    .from("payment")
    .insert({
      paymentId: readablePaymentId,
      paymentType: "Disbursement",
      status: "Draft",
      supplierId: args.supplierId,
      paymentDate: args.paymentDate,
      postingDate: args.paymentDate,
      currencyCode: args.currencyCode,
      exchangeRate: args.invoiceExchangeRate,
      totalAmount: args.amount,
      bankAccount: args.bankAccount,
      memo: args.memo,
      companyId: ctx.companyId,
      createdBy: "system"
    })
    .select("id")
    .single();
  if (paymentRow.error || !paymentRow.data) {
    return {
      fail: `Failed to create payment: ${
        paymentRow.error?.message ?? "unknown error"
      }`
    };
  }
  const paymentRowId = paymentRow.data.id;

  const settlement = await ctx.client.from("invoiceSettlement").insert({
    paymentId: paymentRowId,
    targetPurchaseInvoiceId: args.invoiceRowId,
    appliedAmount: args.amount,
    discountAmount: 0,
    writeOffAmount: 0,
    sourceExchangeRate: 1,
    targetExchangeRate: args.invoiceExchangeRate,
    appliedDate: args.paymentDate,
    companyId: ctx.companyId,
    createdBy: "system"
  });
  if (settlement.error) {
    await ctx.client
      .from("payment")
      .delete()
      .eq("id", paymentRowId)
      .eq("companyId", ctx.companyId);
    return {
      fail: `Failed to create invoice settlement: ${settlement.error.message}`
    };
  }

  const posted = await ctx.client.functions.invoke("post-payment", {
    body: {
      type: "post",
      paymentId: paymentRowId,
      userId: "system",
      companyId: ctx.companyId
    }
  });
  if (posted.error) {
    await ctx.client
      .from("invoiceSettlement")
      .delete()
      .eq("paymentId", paymentRowId)
      .eq("companyId", ctx.companyId);
    await ctx.client
      .from("payment")
      .delete()
      .eq("id", paymentRowId)
      .eq("companyId", ctx.companyId);
    const message =
      posted.error instanceof Error
        ? posted.error.message
        : String(posted.error);
    return { fail: message };
  }

  return { paymentRowId, readablePaymentId };
}

/**
 * Sync one Ramp bill's payment into Carbon as a posted AP `payment` +
 * `invoiceSettlement` that closes the bill's invoice. Returns `ok` (created +
 * posted), `skip` (card-paid, or already synced — confirm only), or `fail`.
 * The confirm/mapping id is the Ramp PAYMENT id (not the bill id).
 */
async function syncBillPayment(
  ctx: Ctx,
  bill: RampBill,
  payment: RampBillPayment
): Promise<{ ok: SyncItem } | { skip: SyncItem } | { fail: FailItem }> {
  const paymentRampId = payment.id;
  if (!paymentRampId) {
    return { fail: { id: bill.id, message: "Bill payment has no id" } };
  }

  // Card-paid bills route through card accounting — confirm without posting.
  const method = payment.payment_method ?? "";
  if (CARD_PAYMENT_METHODS.has(method)) {
    console.log(
      `[RAMP SYNC] ${ctx.companyId}: bill ${bill.id} paid by card (${method}) — routed through card accounting, not posting an AP payment`
    );
    return { skip: { id: paymentRampId, referenceId: paymentRampId } };
  }

  // Idempotency: already-synced payment → confirm only.
  const existing = await ctx.mapping.getEntityId(
    "ramp",
    paymentRampId,
    "payment"
  );
  if (existing) {
    return { skip: { id: paymentRampId, referenceId: existing } };
  }

  // Resolve the Carbon invoice via the bill mapping.
  const invoiceId = await ctx.mapping.getEntityId("ramp", bill.id, "bill");
  if (!invoiceId) {
    return {
      fail: {
        id: paymentRampId,
        message: "Bill was never synced to Carbon — sync the bill first"
      }
    };
  }

  const invoice = await ctx.client
    .from("purchaseInvoice")
    .select("id, supplierId, currencyCode, exchangeRate")
    .eq("id", invoiceId)
    .eq("companyId", ctx.companyId)
    .maybeSingle();
  if (!invoice.data) {
    return {
      fail: {
        id: paymentRampId,
        message: "The bill's Carbon invoice no longer exists"
      }
    };
  }

  const currencyCode =
    invoice.data.currencyCode ?? bill.currency_code ?? ctx.baseCurrency;
  const decimals = await getDecimals(ctx, currencyCode);
  const minor = toMinorUnits(payment.amount);
  const amount =
    minor === null
      ? 0
      : fromMinorUnits(Math.abs(minor), currencyCode, decimals);
  const paymentDate = (payment.effective_date ?? payment.payment_date)?.slice(
    0,
    10
  );
  if (!paymentDate) {
    return {
      fail: { id: paymentRampId, message: "Bill payment has no usable date" }
    };
  }

  const invoiceExchangeRate = invoice.data.exchangeRate ?? 1;

  const outcome = await createAndPostPayment(ctx, {
    supplierId: invoice.data.supplierId,
    invoiceRowId: invoiceId,
    invoiceExchangeRate,
    currencyCode,
    amount,
    paymentDate,
    bankAccount: ctx.metadata.statementBankAccountId as string,
    memo: `Ramp bill payment ${paymentRampId}`
  });
  if ("fail" in outcome) {
    return { fail: { id: paymentRampId, message: outcome.fail } };
  }

  await ctx.mapping.link(
    "payment",
    outcome.paymentRowId,
    "ramp",
    paymentRampId,
    {
      createdBy: "system"
    }
  );

  return {
    ok: {
      id: paymentRampId,
      referenceId: outcome.readablePaymentId,
      deepLinkUrl: invoiceDeepLinkUrl(invoiceId)
    }
  };
}

// /********************************************************\
// *        Reimbursements (employee AP invoices)          *
// \********************************************************/

/**
 * Extract the Ramp user a reimbursement belongs to. The `user` object shape is
 * not yet confirmed against a live sandbox; falls back to the flat `user_id`.
 */
function extractRampUser(reimbursement: RampReimbursement): {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null {
  // TODO(task-1): confirm the reimbursement.user object shape.
  const user = reimbursement.user as
    | {
        id?: string;
        user_id?: string;
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
      }
    | null
    | undefined;
  const userId = user?.user_id ?? user?.id ?? reimbursement.user_id ?? null;
  if (!userId) return null;
  return {
    user_id: userId,
    first_name: user?.first_name ?? null,
    last_name: user?.last_name ?? null,
    email: user?.email ?? null
  };
}

/**
 * Build G/L-coded invoice lines from an arbitrary Ramp line-item list (bills and
 * reimbursements share the coding shape). Returns an error message when a line is
 * uncoded or the coded account doesn't exist — the caller creates nothing then.
 */
async function buildGlLinesFromItems(
  ctx: Ctx,
  items: RampLineItem[],
  currencyCode: string,
  decimals: number,
  uncoded: string
): Promise<{ lines: BuiltInvoiceLine[] } | { error: string }> {
  if (items.length === 0) {
    return { error: "Reimbursement has no line items to post" };
  }
  const lines: BuiltInvoiceLine[] = [];
  for (const item of items) {
    const { accountId, costCenterId } = codeSelections(
      item.accounting_field_selections
    );
    if (!accountId) return { error: uncoded };
    const minor = toMinorUnits(item.amount);
    const amount =
      minor === null
        ? 0
        : fromMinorUnits(Math.abs(minor), currencyCode, decimals);
    lines.push({
      accountId,
      costCenterId,
      amount,
      description: item.memo ?? null
    });
  }
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const { data: accounts, error } = await ctx.client
    .from("account")
    .select("id")
    .eq("companyId", ctx.companyId)
    .in("id", accountIds);
  if (error) return { error: `Failed to verify accounts: ${error.message}` };
  const known = new Set((accounts ?? []).map((row) => row.id));
  if (accountIds.some((id) => !known.has(id))) return { error: uncoded };
  return { lines };
}

/**
 * Sync one Ramp reimbursement into Carbon as a posted purchase invoice against an
 * auto-created "Employee" supplier (Task 8's standalone-invoice shape). When the
 * reimbursement was PAID by Ramp, also posts the AP payment that closes it; a
 * manual-payout (APPROVED) reimbursement is left Open. The confirm/mapping id is
 * the Ramp reimbursement id (reusing the `bill` entityType — distinct id space).
 */
async function syncReimbursement(
  ctx: Ctx,
  reimbursement: RampReimbursement
): Promise<{ ok: SyncItem } | { fail: FailItem }> {
  const rampUser = extractRampUser(reimbursement);
  if (!rampUser) {
    return {
      fail: {
        id: reimbursement.id,
        message:
          "Reimbursement has no user — cannot resolve an employee supplier"
      }
    };
  }

  let supplierId: string;
  try {
    supplierId = await resolveEmployeeSupplier(
      ctx.client,
      ctx.db,
      ctx.companyId,
      rampUser
    );
  } catch (supplierError) {
    return {
      fail: {
        id: reimbursement.id,
        message:
          supplierError instanceof Error
            ? supplierError.message
            : String(supplierError)
      }
    };
  }

  const currencyCode = reimbursement.currency_code ?? ctx.baseCurrency;
  const decimals = await getDecimals(ctx, currencyCode);

  const built = await buildGlLinesFromItems(
    ctx,
    reimbursement.line_items ?? [],
    currencyCode,
    decimals,
    "Reimbursement line is coded to an account Carbon doesn't recognize — recode it in Ramp"
  );
  if ("error" in built) {
    return { fail: { id: reimbursement.id, message: built.error } };
  }

  const dateIssued = reimbursement.transaction_date?.slice(0, 10) ?? null;
  const dateDue = reimbursement.approved_at?.slice(0, 10) ?? null;

  const interaction = await ctx.client
    .from("supplierInteraction")
    .insert([{ companyId: ctx.companyId, supplierId }])
    .select("id")
    .single();
  if (interaction.error || !interaction.data) {
    return {
      fail: {
        id: reimbursement.id,
        message: `Failed to create supplier interaction: ${
          interaction.error?.message ?? "unknown error"
        }`
      }
    };
  }

  const seq = await ctx.client.rpc("get_next_sequence", {
    sequence_name: "purchaseInvoice",
    company_id: ctx.companyId
  });
  if (seq.error || !seq.data) {
    return {
      fail: {
        id: reimbursement.id,
        message: `Failed to generate invoice number: ${
          seq.error?.message ?? "unknown error"
        }`
      }
    };
  }
  const readableId = seq.data as string;

  const header = await ctx.client
    .from("purchaseInvoice")
    .insert({
      invoiceId: readableId,
      status: "Draft",
      supplierId,
      supplierReference: `RAMP-REIMB-${reimbursement.id}`,
      currencyCode,
      dateIssued,
      dateDue,
      supplierInteractionId: interaction.data.id,
      companyId: ctx.companyId,
      createdBy: "system"
    })
    .select("id")
    .single();
  if (header.error || !header.data) {
    return {
      fail: {
        id: reimbursement.id,
        message: `Failed to create purchase invoice: ${
          header.error?.message ?? "unknown error"
        }`
      }
    };
  }
  const invoiceRowId = header.data.id;

  const lineRows = built.lines.map((line, lineIndex) => ({
    invoiceId: invoiceRowId,
    invoiceLineType: "G/L Account" as const,
    accountId: line.accountId,
    costCenterId: line.costCenterId,
    description: line.description,
    quantity: 1,
    unitPrice: line.amount,
    exchangeRate: 1,
    sortOrder: lineIndex + 1,
    companyId: ctx.companyId,
    createdBy: "system"
  }));
  const insertedLines = await ctx.client
    .from("purchaseInvoiceLine")
    .insert(lineRows);
  if (insertedLines.error) {
    await ctx.client
      .from("purchaseInvoice")
      .delete()
      .eq("id", invoiceRowId)
      .eq("companyId", ctx.companyId);
    return {
      fail: {
        id: reimbursement.id,
        message: `Failed to create invoice lines: ${insertedLines.error.message}`
      }
    };
  }

  const postOutcome = await postPurchaseInvoice(ctx, invoiceRowId);
  if ("fail" in postOutcome) {
    return { fail: { id: reimbursement.id, message: postOutcome.fail } };
  }

  // The reimbursement is now recorded — link the mapping BEFORE the (optional)
  // payment so a later payment failure cannot cause a duplicate invoice on retry.
  await ctx.mapping.link("bill", invoiceRowId, "ramp", reimbursement.id, {
    createdBy: "system"
  });

  // Ramp-paid reimbursements post the AP payment that closes the invoice; a
  // manual-payout (APPROVED) reimbursement is left Open for Carbon to pay.
  const isRampPaid = reimbursement.state
    ? REIMBURSEMENT_PAID_STATES.has(reimbursement.state)
    : false;
  if (isRampPaid) {
    const bankAccount =
      ctx.metadata.reimbursementBankAccountId ??
      ctx.metadata.statementBankAccountId;
    if (!bankAccount) {
      console.error(
        `[RAMP SYNC] ${ctx.companyId}: reimbursement ${reimbursement.id} is Ramp-paid but no reimbursement/statement bank account is configured — invoice left Open`
      );
    } else {
      const minor = toMinorUnits(reimbursement.amount);
      const amount =
        minor === null
          ? 0
          : fromMinorUnits(Math.abs(minor), currencyCode, decimals);
      const paymentDate = (
        reimbursement.approved_at ?? reimbursement.transaction_date
      )?.slice(0, 10);
      if (amount > 0 && paymentDate) {
        const paymentOutcome = await createAndPostPayment(ctx, {
          supplierId,
          invoiceRowId,
          invoiceExchangeRate: 1,
          currencyCode,
          amount,
          paymentDate,
          bankAccount,
          memo: `Ramp reimbursement ${reimbursement.id}`
        });
        if ("fail" in paymentOutcome) {
          // Non-fatal: the expense (invoice) IS synced — leave it Open and log.
          console.error(
            `[RAMP SYNC] ${ctx.companyId}: reimbursement ${reimbursement.id} invoice posted but payment failed — ${paymentOutcome.fail}`
          );
        }
      }
    }
  }

  return {
    ok: {
      id: reimbursement.id,
      referenceId: postOutcome.readableId,
      deepLinkUrl: invoiceDeepLinkUrl(invoiceRowId)
    }
  };
}

// /********************************************************\
// *              Repayments (Repayment cards)             *
// \********************************************************/

/** Subtract one second from an absolute-instant ISO string (timezone-agnostic). */
function instantMinusOneSecond(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  // Full-instant transform (not a calendar-day derivation) — allowed server-side.
  return new Date(ms - 1000).toISOString();
}

/**
 * Compute the next repayment cursor = `min(max(processed), min(failed) - 1s)`.
 * A failed item pulls the cursor back before its own `repaid_at` so the next
 * sweep re-lists it (only advance over provably-covered work). Returns `null`
 * when nothing was seen.
 */
function computeRepaymentCursor(
  processedRepaidAt: string[],
  failedRepaidAt: string[]
): string | null {
  let candidate: string | null = null;
  if (processedRepaidAt.length > 0) {
    candidate = processedRepaidAt.reduce((max, cur) =>
      Date.parse(cur) > Date.parse(max) ? cur : max
    );
  }
  if (failedRepaidAt.length > 0) {
    const minFailed = failedRepaidAt.reduce((min, cur) =>
      Date.parse(cur) < Date.parse(min) ? cur : min
    );
    const cappedFailed = instantMinusOneSecond(minFailed);
    if (
      candidate === null ||
      Date.parse(cappedFailed) < Date.parse(candidate)
    ) {
      candidate = cappedFailed;
    }
  }
  return candidate;
}

/** Read-merge-write `metadata.cursors.repaymentsRepaidAt` on the integration row. */
async function advanceRepaymentCursor(ctx: Ctx, next: string): Promise<void> {
  const current = await ctx.client
    .from("companyIntegration")
    .select("metadata")
    .eq("id", "ramp")
    .eq("companyId", ctx.companyId)
    .single();
  if (current.error) {
    console.error(
      `[RAMP SYNC] ${ctx.companyId}: failed to read metadata for repayment cursor`,
      current.error
    );
    return;
  }
  const metadata =
    (current.data?.metadata as Record<string, unknown> | null) ?? {};
  const cursors = (metadata.cursors as Record<string, unknown> | null) ?? {};
  cursors.repaymentsRepaidAt = next;
  metadata.cursors = cursors;
  const updated = await ctx.client
    .from("companyIntegration")
    .update({ metadata: metadata as never })
    .eq("id", "ramp")
    .eq("companyId", ctx.companyId);
  if (updated.error) {
    console.error(
      `[RAMP SYNC] ${ctx.companyId}: failed to persist repayment cursor`,
      updated.error
    );
  }
}

export const rampSyncFunction = inngest.createFunction(
  {
    id: "ramp-sync",
    retries: 2,
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/ramp-sync" },
  async ({ event, step }) => {
    const { companyId } = event.data;
    const client = getCarbonServiceRole();

    const integration = await getRampIntegration(client, companyId);
    if (!integration) {
      return { companyId, skipped: "ramp not installed/active" };
    }
    const { client: ramp, metadata } = integration;

    // Company scope (currency decimals, document groups) + the notification
    // recipient. One read, outside the family steps.
    const company = await client
      .from("company")
      .select("companyGroupId, baseCurrencyCode")
      .eq("id", companyId)
      .single();
    const integrationRow = await client
      .from("companyIntegration")
      .select("updatedBy, updatedAt")
      .eq("id", "ramp")
      .eq("companyId", companyId)
      .maybeSingle();

    const jobDb = getJobDatabaseClient(5);
    const ctx: Ctx = {
      client,
      db: jobDb,
      mapping: createMappingService(jobDb, companyId),
      companyId,
      metadata,
      baseCurrency: company.data?.baseCurrencyCode ?? "USD",
      companyGroupId: company.data?.companyGroupId ?? null,
      decimalsCache: new Map(),
      exchangeRateCache: new Map()
    };

    const cardLiabilityAccountId = metadata.cardLiabilityAccountId;
    const entityId = metadata.entityId;

    // ---- Card transactions (Charge / Credit) -----------------------------
    const cardResult = await step.run("ramp-card-transactions", async () => {
      const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
      if (!metadata.sync.pullTransactions) return result;
      if (!cardLiabilityAccountId) {
        console.warn(
          `[RAMP SYNC] ${companyId}: no cardLiabilityAccountId configured — skipping card transactions`
        );
        return result;
      }

      const successful: SyncItem[] = [];
      const failed: FailItem[] = [];
      const mapped: Array<{ rampId: string; entityId: string }> = [];

      try {
        for await (const page of ramp.listTransactions({
          sync_status: "SYNC_READY",
          ...(entityId ? { entity_id: entityId } : {})
        })) {
          for (const tx of page as RampTransaction[]) {
            const existing = await ctx.mapping.getEntityId(
              "ramp",
              tx.id,
              "cardTransaction"
            );
            if (existing) {
              mapped.push({ rampId: tx.id, entityId: existing });
              continue;
            }

            const currencyCode =
              tx.entity_amount?.currency ??
              tx.currency_code ??
              tx.currency ??
              ctx.baseCurrency;
            const decimals = await getDecimals(ctx, currencyCode);
            // Prefer `entity_amount.value` (signed integer minor units / cents)
            // — the non-deprecated settlement amount per the Ramp OpenAPI spec.
            // The top-level `amount` is DEPRECATED and a major-unit (dollar)
            // float, so reading it as minor units understated every charge 100×.
            // Fall back to it only when entity_amount is absent (rare: no valid
            // settlement currency). Verified 2026-08-28 against the spec.
            const rawMinor = toMinorUnits(tx.entity_amount) ?? tx.amount ?? 0;
            const isCredit =
              rawMinor < 0 || Boolean(tx.original_transaction_id);
            const headerAmount = fromMinorUnits(
              Math.abs(rawMinor),
              currencyCode,
              decimals
            );

            const built = await buildTransactionLines(
              ctx,
              tx,
              currencyCode,
              decimals,
              headerAmount
            );
            if ("error" in built) {
              failed.push({ id: tx.id, message: built.error });
              continue;
            }

            const transactionDate = (
              tx.user_transaction_time ??
              tx.accounting_date ??
              tx.settlement_date
            )?.slice(0, 10);
            if (!transactionDate) {
              failed.push({
                id: tx.id,
                message: "Transaction has no usable date"
              });
              continue;
            }

            const holder = tx.card_holder
              ? [tx.card_holder.first_name, tx.card_holder.last_name]
                  .filter(Boolean)
                  .join(" ") || null
              : null;

            const outcome = await createAndPostTransaction(ctx, {
              rampId: tx.id,
              type: isCredit ? "Credit" : "Charge",
              amount: headerAmount,
              currencyCode,
              transactionDate,
              postingDate: tx.accounting_date?.slice(0, 10) ?? null,
              cardAccountId: cardLiabilityAccountId,
              offsetAccountId: null,
              merchantName: tx.merchant_name ?? null,
              cardHolderName: holder,
              memo: tx.memo ?? null,
              lines: built.lines,
              receiptIds: tx.receipts ?? [],
              getReceipt: (id) => ramp.getReceipt(id)
            });
            if ("ok" in outcome) successful.push(outcome.ok);
            else failed.push(outcome.fail);
          }
        }
      } catch (familyError) {
        console.error(
          `[RAMP SYNC] ${companyId}: card transactions drain failed`,
          familyError
        );
      }

      successful.push(...(await reconfirmMapped(ctx, mapped)));

      try {
        await confirmSyncs(client, companyId, {
          syncType: "TRANSACTION_SYNC",
          successful,
          failed
        });
      } catch (confirmError) {
        console.error(
          `[RAMP SYNC] ${companyId}: TRANSACTION_SYNC confirm failed`,
          confirmError
        );
      }

      result.created = successful.length - mapped.length;
      result.reconfirmed = mapped.length;
      result.failed = failed.length;
      return result;
    });

    // ---- Transfers (statement Payment) -----------------------------------
    const transferResult = await step.run("ramp-transfers", async () => {
      const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
      if (!cardLiabilityAccountId || !metadata.statementBankAccountId) {
        return result;
      }

      const successful: SyncItem[] = [];
      const failed: FailItem[] = [];
      const mapped: Array<{ rampId: string; entityId: string }> = [];

      try {
        for await (const page of ramp.listTransfers({
          sync_status: "SYNC_READY"
        })) {
          for (const transfer of page as RampTransfer[]) {
            const existing = await ctx.mapping.getEntityId(
              "ramp",
              transfer.id,
              "cardTransaction"
            );
            if (existing) {
              mapped.push({ rampId: transfer.id, entityId: existing });
              continue;
            }

            const currencyCode = transfer.currency_code ?? ctx.baseCurrency;
            const decimals = await getDecimals(ctx, currencyCode);
            const minor = toMinorUnits(transfer.amount) ?? 0;
            const amount = fromMinorUnits(
              Math.abs(minor),
              currencyCode,
              decimals
            );
            const transactionDate = transfer.created_at?.slice(0, 10);
            if (!transactionDate) {
              failed.push({
                id: transfer.id,
                message: "Transfer has no usable date"
              });
              continue;
            }

            const outcome = await createAndPostTransaction(ctx, {
              rampId: transfer.id,
              type: "Payment",
              amount,
              currencyCode,
              transactionDate,
              postingDate: transactionDate,
              cardAccountId: cardLiabilityAccountId,
              offsetAccountId: metadata.statementBankAccountId,
              merchantName: null,
              cardHolderName: null,
              memo: null,
              lines: [],
              receiptIds: [],
              getReceipt: (id) => ramp.getReceipt(id)
            });
            if ("ok" in outcome) successful.push(outcome.ok);
            else failed.push(outcome.fail);
          }
        }
      } catch (familyError) {
        console.error(
          `[RAMP SYNC] ${companyId}: transfers drain failed`,
          familyError
        );
      }

      successful.push(...(await reconfirmMapped(ctx, mapped)));

      try {
        await confirmSyncs(client, companyId, {
          syncType: "TRANSFER_SYNC",
          successful,
          failed
        });
      } catch (confirmError) {
        console.error(
          `[RAMP SYNC] ${companyId}: TRANSFER_SYNC confirm failed`,
          confirmError
        );
      }

      result.created = successful.length - mapped.length;
      result.reconfirmed = mapped.length;
      result.failed = failed.length;
      return result;
    });

    // ---- Cashbacks (statement credit) ------------------------------------
    const cashbackResult = await step.run("ramp-cashbacks", async () => {
      const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
      // Skip the family silently when no cashback income account is configured.
      if (!cardLiabilityAccountId || !metadata.cashbackIncomeAccountId) {
        return result;
      }

      const successful: SyncItem[] = [];
      const failed: FailItem[] = [];
      const mapped: Array<{ rampId: string; entityId: string }> = [];

      try {
        for await (const page of ramp.listCashbacks({
          sync_status: "SYNC_READY"
        })) {
          for (const cashback of page as RampCashback[]) {
            const existing = await ctx.mapping.getEntityId(
              "ramp",
              cashback.id,
              "cardTransaction"
            );
            if (existing) {
              mapped.push({ rampId: cashback.id, entityId: existing });
              continue;
            }

            const currencyCode = cashback.currency_code ?? ctx.baseCurrency;
            const decimals = await getDecimals(ctx, currencyCode);
            const minor = toMinorUnits(cashback.amount) ?? 0;
            const amount = fromMinorUnits(
              Math.abs(minor),
              currencyCode,
              decimals
            );
            const transactionDate = cashback.created_at?.slice(0, 10);
            if (!transactionDate) {
              failed.push({
                id: cashback.id,
                message: "Cashback has no usable date"
              });
              continue;
            }

            const outcome = await createAndPostTransaction(ctx, {
              rampId: cashback.id,
              type: "Cashback",
              amount,
              currencyCode,
              transactionDate,
              postingDate: transactionDate,
              cardAccountId: cardLiabilityAccountId,
              offsetAccountId: metadata.cashbackIncomeAccountId,
              merchantName: null,
              cardHolderName: null,
              memo: null,
              lines: [],
              receiptIds: [],
              getReceipt: (id) => ramp.getReceipt(id)
            });
            if ("ok" in outcome) successful.push(outcome.ok);
            else failed.push(outcome.fail);
          }
        }
      } catch (familyError) {
        console.error(
          `[RAMP SYNC] ${companyId}: cashbacks drain failed`,
          familyError
        );
      }

      successful.push(...(await reconfirmMapped(ctx, mapped)));

      try {
        await confirmSyncs(client, companyId, {
          syncType: "STATEMENT_CREDIT_SYNC",
          successful,
          failed
        });
      } catch (confirmError) {
        console.error(
          `[RAMP SYNC] ${companyId}: STATEMENT_CREDIT_SYNC confirm failed`,
          confirmError
        );
      }

      result.created = successful.length - mapped.length;
      result.reconfirmed = mapped.length;
      result.failed = failed.length;
      return result;
    });

    // ---- Bills (AP purchase invoices) ------------------------------------
    const billResult = await step.run("ramp-bills", async () => {
      const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
      if (!metadata.sync.pullBills) return result;

      const successful: SyncItem[] = [];
      const failed: FailItem[] = [];
      const mapped: Array<{ rampId: string; entityId: string }> = [];
      let reconfirmed = 0;

      try {
        for await (const page of ramp.listBills({
          sync_ready: true,
          // TODO(task-1): confirm the NOT_SYNCED sync_status string + sync_ready param.
          sync_status: "NOT_SYNCED"
        })) {
          for (const bill of page as RampBill[]) {
            const existing = await ctx.mapping.getEntityId(
              "ramp",
              bill.id,
              "bill"
            );
            if (existing) {
              // Batched reconfirm after the drain (one query, not one per bill).
              mapped.push({ rampId: bill.id, entityId: existing });
              continue;
            }

            const outcome = await syncBill(ctx, bill);
            if ("ok" in outcome) {
              successful.push(outcome.ok);
            } else if ("skip" in outcome) {
              successful.push(outcome.skip);
              reconfirmed += 1;
            } else {
              failed.push(outcome.fail);
            }
          }
        }
      } catch (familyError) {
        console.error(
          `[RAMP SYNC] ${companyId}: bills drain failed`,
          familyError
        );
      }

      successful.push(...(await reconfirmMappedInvoices(ctx, mapped)));
      reconfirmed += mapped.length;

      try {
        await confirmSyncs(client, companyId, {
          syncType: "BILL_SYNC",
          successful,
          failed
        });
      } catch (confirmError) {
        console.error(
          `[RAMP SYNC] ${companyId}: BILL_SYNC confirm failed`,
          confirmError
        );
      }

      result.created = successful.length - reconfirmed;
      result.reconfirmed = reconfirmed;
      result.failed = failed.length;
      return result;
    });

    // ---- Bill payments (AP payments) -------------------------------------
    const billPaymentResult = await step.run("ramp-bill-payments", async () => {
      const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
      // Bill payments ride the same gate as bills (no separate flag).
      if (!metadata.sync.pullBills) return result;
      if (!metadata.statementBankAccountId) {
        console.warn(
          `[RAMP SYNC] ${companyId}: no statementBankAccountId configured — skipping bill payments`
        );
        return result;
      }

      const successful: SyncItem[] = [];
      const failed: FailItem[] = [];
      let reconfirmed = 0;

      try {
        for await (const page of ramp.listBills({
          sync_ready: true,
          // TODO(task-1): confirm the BILL_SYNCED sync_status string.
          sync_status: "BILL_SYNCED"
        })) {
          for (const bill of page as RampBill[]) {
            // TODO(task-1): confirm bill.status vs payment.status for PAID.
            if (bill.status !== BILL_PAID_STATUS) continue;
            const payment = bill.payment;
            if (!payment) continue;

            const outcome = await syncBillPayment(ctx, bill, payment);
            if ("ok" in outcome) {
              successful.push(outcome.ok);
            } else if ("skip" in outcome) {
              successful.push(outcome.skip);
              reconfirmed += 1;
            } else {
              failed.push(outcome.fail);
            }
          }
        }
      } catch (familyError) {
        console.error(
          `[RAMP SYNC] ${companyId}: bill payments drain failed`,
          familyError
        );
      }

      try {
        await confirmSyncs(client, companyId, {
          syncType: "BILL_PAYMENT_SYNC",
          successful,
          failed
        });
      } catch (confirmError) {
        console.error(
          `[RAMP SYNC] ${companyId}: BILL_PAYMENT_SYNC confirm failed`,
          confirmError
        );
      }

      result.created = successful.length - reconfirmed;
      result.reconfirmed = reconfirmed;
      result.failed = failed.length;
      return result;
    });

    // ---- Reimbursements (employee AP invoices) ---------------------------
    const reimbursementResult = await step.run(
      "ramp-reimbursements",
      async () => {
        const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
        if (!metadata.sync.pullReimbursements) return result;

        const successful: SyncItem[] = [];
        const failed: FailItem[] = [];
        const mapped: Array<{ rampId: string; entityId: string }> = [];
        let reconfirmed = 0;

        try {
          for await (const page of ramp.listReimbursements({
            sync_status: "SYNC_READY"
          })) {
            for (const reimbursement of page as RampReimbursement[]) {
              // Idempotency: already synced → reconfirm only (reuses `bill`).
              const existing = await ctx.mapping.getEntityId(
                "ramp",
                reimbursement.id,
                "bill"
              );
              if (existing) {
                // Batched reconfirm after the drain (one query, not one per item).
                mapped.push({ rampId: reimbursement.id, entityId: existing });
                continue;
              }

              const outcome = await syncReimbursement(ctx, reimbursement);
              if ("ok" in outcome) successful.push(outcome.ok);
              else failed.push(outcome.fail);
            }
          }
        } catch (familyError) {
          console.error(
            `[RAMP SYNC] ${companyId}: reimbursements drain failed`,
            familyError
          );
        }

        successful.push(...(await reconfirmMappedInvoices(ctx, mapped)));
        reconfirmed += mapped.length;

        try {
          await confirmSyncs(client, companyId, {
            syncType: "REIMBURSEMENT_SYNC",
            successful,
            failed
          });
        } catch (confirmError) {
          console.error(
            `[RAMP SYNC] ${companyId}: REIMBURSEMENT_SYNC confirm failed`,
            confirmError
          );
        }

        result.created = successful.length - reconfirmed;
        result.reconfirmed = reconfirmed;
        result.failed = failed.length;
        return result;
      }
    );

    // ---- Repayments (Repayment card transactions) ------------------------
    const repaymentResult = await step.run("ramp-repayments", async () => {
      const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
      // Repayments ride the same expense-recording gate as reimbursements.
      if (!metadata.sync.pullReimbursements) return result;
      if (!cardLiabilityAccountId || !metadata.statementBankAccountId) {
        return result;
      }

      // Cursor default: the integration's connect time (its row `updatedAt`).
      const cursor =
        metadata.cursors?.repaymentsRepaidAt ??
        integrationRow.data?.updatedAt ??
        undefined;

      const processedRepaidAt: string[] = [];
      const failedRepaidAt: string[] = [];
      let created = 0;
      let reconfirmed = 0;
      let failed = 0;

      try {
        for await (const page of ramp.listRepayments(
          cursor ? { from_repaid_at: cursor } : {}
        )) {
          for (const repayment of page as RampRepayment[]) {
            if (repayment.status !== REPAYMENT_REPAID_STATUS) continue;
            const repaidAt = repayment.repaid_at ?? null;

            // Idempotency: already synced (no Ramp confirm exists — mapping is it).
            const existing = await ctx.mapping.getEntityId(
              "ramp",
              `repayment:${repayment.id}`,
              "cardTransaction"
            );
            if (existing) {
              reconfirmed += 1;
              if (repaidAt) processedRepaidAt.push(repaidAt);
              continue;
            }

            // Resolve the ORIGINAL card transaction via its mapping.
            const originalRampId = repayment.original_transaction_id;
            if (!originalRampId) {
              failed += 1;
              if (repaidAt) failedRepaidAt.push(repaidAt);
              console.error(
                `[RAMP SYNC] ${companyId}: repayment ${repayment.id} has no original_transaction_id — skipped`
              );
              continue;
            }
            const originalEntityId = await ctx.mapping.getEntityId(
              "ramp",
              originalRampId,
              "cardTransaction"
            );
            if (!originalEntityId) {
              failed += 1;
              if (repaidAt) failedRepaidAt.push(repaidAt);
              console.error(
                `[RAMP SYNC] ${companyId}: repayment ${repayment.id} original transaction ${originalRampId} is not synced yet — skipped`
              );
              continue;
            }

            const original = await ctx.client
              .from("cardTransaction")
              .select("amount, currencyCode")
              .eq("id", originalEntityId)
              .eq("companyId", companyId)
              .maybeSingle();
            if (!original.data) {
              failed += 1;
              if (repaidAt) failedRepaidAt.push(repaidAt);
              console.error(
                `[RAMP SYNC] ${companyId}: repayment ${repayment.id} original card transaction ${originalEntityId} no longer exists — skipped`
              );
              continue;
            }
            const originalLines = await ctx.client
              .from("cardTransactionLine")
              .select("accountId, amount, costCenterId, description")
              .eq("cardTransactionId", originalEntityId)
              .eq("companyId", companyId)
              .order("sequence", { ascending: true });
            if (originalLines.error) {
              failed += 1;
              if (repaidAt) failedRepaidAt.push(repaidAt);
              console.error(
                `[RAMP SYNC] ${companyId}: repayment ${repayment.id} failed to load original lines`,
                originalLines.error
              );
              continue;
            }

            const currencyCode =
              repayment.currency_code ??
              original.data.currencyCode ??
              ctx.baseCurrency;
            const decimals = await getDecimals(ctx, currencyCode);
            const minor = toMinorUnits(
              repayment.repayment_amount ?? repayment.amount
            );
            const repaymentAmount =
              minor === null
                ? 0
                : fromMinorUnits(Math.abs(minor), currencyCode, decimals);

            const scaled = scaleRepaymentLines(
              (originalLines.data ?? []).map((line) => ({
                accountId: line.accountId,
                amount: line.amount,
                costCenterId: line.costCenterId,
                description: line.description
              })),
              repaymentAmount,
              original.data.amount,
              decimals
            );

            // Funding: bank deposit → statement bank; statement credit → card
            // liability. TODO(task-1): confirm the funding_method enum values.
            const offsetAccountId =
              repayment.funding_method === REPAYMENT_STATEMENT_CREDIT_FUNDING
                ? cardLiabilityAccountId
                : (metadata.statementBankAccountId as string);

            const transactionDate = repaidAt?.slice(0, 10);
            if (!transactionDate) {
              failed += 1;
              console.error(
                `[RAMP SYNC] ${companyId}: repayment ${repayment.id} has no repaid_at — skipped`
              );
              continue;
            }

            const outcome = await createAndPostTransaction(ctx, {
              rampId: `repayment:${repayment.id}`,
              type: "Repayment",
              amount: repaymentAmount,
              currencyCode,
              transactionDate,
              postingDate: transactionDate,
              cardAccountId: cardLiabilityAccountId,
              offsetAccountId,
              merchantName: null,
              cardHolderName: null,
              memo: `Ramp repayment ${repayment.id}`,
              lines: scaled.map((line) => ({
                accountId: line.accountId,
                amount: line.amount,
                costCenterId: line.costCenterId,
                description: line.description
              })),
              receiptIds: [],
              getReceipt: (id) => ramp.getReceipt(id)
            });
            if ("ok" in outcome) {
              created += 1;
              if (repaidAt) processedRepaidAt.push(repaidAt);
            } else {
              failed += 1;
              if (repaidAt) failedRepaidAt.push(repaidAt);
              console.error(
                `[RAMP SYNC] ${companyId}: repayment ${repayment.id} failed — ${outcome.fail.message}`
              );
            }
          }
        }
      } catch (familyError) {
        console.error(
          `[RAMP SYNC] ${companyId}: repayments drain failed`,
          familyError
        );
      }

      // Advance the cursor to min(max(processed), min(failed) - 1s) so failed
      // items are re-listed next sweep (there is no Ramp confirm for repayments).
      const nextCursor = computeRepaymentCursor(
        processedRepaidAt,
        failedRepaidAt
      );
      if (nextCursor) {
        await advanceRepaymentCursor(ctx, nextCursor);
      }

      result.created = created;
      result.reconfirmed = reconfirmed;
      result.failed = failed;
      return result;
    });

    // ---- Outbound (PO push, invoice draft-bill push, archive-on-settlement) --
    const outboundResult = await step.run("ramp-outbound", async () => {
      const result = {
        purchaseOrders: { pushed: 0, archived: 0, failed: 0 },
        invoices: { pushed: 0, failed: 0, archived: 0 }
      };

      // -- 1. Purchase-order push --------------------------------------------
      if (metadata.sync.pushPurchaseOrders) {
        try {
          const cursor =
            metadata.cursors?.purchaseOrderPushUpdatedAt ??
            integrationRow.data?.updatedAt ??
            undefined;

          let poQuery = client
            .from("purchaseOrder")
            .select(
              "id, purchaseOrderId, status, supplierId, currencyCode, updatedAt"
            )
            .eq("companyId", companyId)
            .in("status", PO_PUSH_STATUSES)
            .order("updatedAt", { ascending: true })
            .limit(OUTBOUND_PAGE_SIZE);
          if (cursor) poQuery = poQuery.gt("updatedAt", cursor);
          const pos = await poQuery;
          if (pos.error) throw pos.error;
          const poRows = pos.data ?? [];

          if (poRows.length > 0) {
            // Batch the supplier vendor details + lines (never a query per PO).
            const supplierIds = [
              ...new Set(poRows.map((row) => row.supplierId))
            ];
            const supplierById = await loadRampVendorSuppliers(
              ctx,
              supplierIds
            );
            // Ramp requires an entity_id on a PO create — resolve it once.
            const rampEntityId = await resolveRampEntityId(metadata, ramp);

            const poIds = poRows.map((row) => row.id);
            const lines = await client
              .from("purchaseOrderLine")
              .select(
                "id, purchaseOrderId, description, purchaseQuantity, unitPrice, purchaseOrderLineType, sortOrder"
              )
              .eq("companyId", companyId)
              .in("purchaseOrderId", poIds)
              .neq("purchaseOrderLineType", "Comment")
              .order("sortOrder", { ascending: true });
            const linesByPo = new Map<
              string,
              Array<{
                id: string;
                description: string | null;
                quantity: number | null;
                unitPrice: number | null;
              }>
            >();
            for (const line of lines.data ?? []) {
              const list = linesByPo.get(line.purchaseOrderId) ?? [];
              list.push({
                id: line.id,
                description: line.description,
                quantity: line.purchaseQuantity,
                unitPrice: line.unitPrice
              });
              linesByPo.set(line.purchaseOrderId, list);
            }

            const failedUpdatedAt: string[] = [];
            const allUpdatedAt: string[] = [];
            for (const row of poRows) {
              if (row.updatedAt) allUpdatedAt.push(row.updatedAt);
              try {
                const action = await pushPurchaseOrder(ctx.mapping, ramp, {
                  id: row.id,
                  readableId: row.purchaseOrderId,
                  status: row.status,
                  supplier:
                    supplierById.get(row.supplierId) ??
                    emptyRampVendorSupplier(row.supplierId, null),
                  currencyCode: row.currencyCode ?? ctx.baseCurrency,
                  entityId: rampEntityId,
                  lines: linesByPo.get(row.id) ?? []
                });
                if (action === "archived") result.purchaseOrders.archived += 1;
                else if (action === "created" || action === "patched")
                  result.purchaseOrders.pushed += 1;
              } catch (poError) {
                result.purchaseOrders.failed += 1;
                if (row.updatedAt) failedUpdatedAt.push(row.updatedAt);
                console.error(
                  `[RAMP SYNC] ${companyId}: purchase order ${row.purchaseOrderId} push failed`,
                  poError
                );
              }
            }

            // Advance to max(processed); a failure holds the cursor back before
            // its own updatedAt so the next sweep re-lists it (Task 9 shape).
            const next = computeRepaymentCursor(allUpdatedAt, failedUpdatedAt);
            if (next) {
              await advanceRampCursor(
                client,
                companyId,
                "purchaseOrderPushUpdatedAt",
                next
              );
            }
          }
        } catch (familyError) {
          console.error(
            `[RAMP SYNC] ${companyId}: purchase-order push failed`,
            familyError
          );
        }
      }

      // -- 2 + 3. Invoice draft-bill push & archive-on-settlement -------------
      if (metadata.sync.pushInvoices) {
        try {
          // One scan of the `bill` mappings drives BOTH the push dedupe (skip an
          // invoice already mapped in either direction — Task 8) and the archive.
          const billMappings = await ctx.mapping.getAllByIntegration(
            "ramp",
            "bill"
          );
          const mappedInvoiceIds = new Set(billMappings.map((m) => m.entityId));

          // 2. Push posted invoices that are still Open / Partially Paid.
          const cursor =
            metadata.cursors?.invoicePushUpdatedAt ??
            integrationRow.data?.updatedAt ??
            undefined;

          let invQuery = client
            .from("purchaseInvoices")
            .select(
              "id, invoiceId, supplierId, supplierReference, currencyCode, dateIssued, dateDue, updatedAt"
            )
            .eq("companyId", companyId)
            .in("status", INVOICE_PUSH_STATUSES)
            .order("updatedAt", { ascending: true })
            .limit(OUTBOUND_PAGE_SIZE);
          if (cursor) invQuery = invQuery.gt("updatedAt", cursor);
          const invoices = await invQuery;
          if (invoices.error) throw invoices.error;
          const invRows = invoices.data ?? [];
          // Advance past EVERY fetched row (mapped / employee / pushed alike);
          // only a throw holds the cursor back.
          const allUpdatedAt = invRows
            .map((row) => row.updatedAt)
            .filter((value): value is string => Boolean(value));
          const failedUpdatedAt: string[] = [];

          const candidates = invRows.filter(
            (row) => row.id && !mappedInvoiceIds.has(row.id)
          );

          if (candidates.length > 0) {
            const supplierIds = [
              ...new Set(
                candidates
                  .map((row) => row.supplierId)
                  .filter((id): id is string => Boolean(id))
              )
            ];
            const supplierById = await loadRampVendorSuppliers(
              ctx,
              supplierIds
            );

            // Resolve which supplier types are "Employee" (reimbursement
            // suppliers — their invoices never push).
            const typeIds = [
              ...new Set(
                [...supplierById.values()]
                  .map((s) => s.supplierTypeId)
                  .filter((id): id is string => Boolean(id))
              )
            ];
            const employeeTypeIds = new Set<string>();
            if (typeIds.length > 0) {
              const types = await client
                .from("supplierType")
                .select("id, name")
                .eq("companyId", companyId)
                .in("id", typeIds);
              for (const type of types.data ?? []) {
                if (type.name === "Employee") employeeTypeIds.add(type.id);
              }
            }

            const invoiceIds = candidates
              .map((row) => row.id)
              .filter((id): id is string => Boolean(id));
            const invLines = await client
              .from("purchaseInvoiceLine")
              .select("invoiceId, description, totalAmount, sortOrder")
              .eq("companyId", companyId)
              .in("invoiceId", invoiceIds)
              .order("sortOrder", { ascending: true });
            const linesByInvoice = new Map<
              string,
              Array<{ description: string | null; amount: number }>
            >();
            for (const line of invLines.data ?? []) {
              const list = linesByInvoice.get(line.invoiceId) ?? [];
              list.push({
                description: line.description,
                amount: line.totalAmount ?? 0
              });
              linesByInvoice.set(line.invoiceId, list);
            }

            for (const row of candidates) {
              const invoiceRowId = row.id;
              if (!invoiceRowId) continue;
              const supplier = supplierById.get(row.supplierId ?? "");
              // Employee-supplier reimbursements never push.
              if (
                supplier?.supplierTypeId &&
                employeeTypeIds.has(supplier.supplierTypeId)
              ) {
                continue;
              }
              try {
                const outcome = await pushInvoiceDraftBill(
                  client,
                  companyId,
                  ctx.mapping,
                  ramp,
                  {
                    id: invoiceRowId,
                    readableId: row.invoiceId ?? invoiceRowId,
                    supplierReference: row.supplierReference,
                    currencyCode: row.currencyCode,
                    dateIssued: row.dateIssued,
                    dateDue: row.dateDue,
                    supplier:
                      supplier ??
                      emptyRampVendorSupplier(row.supplierId ?? "", null),
                    lines: linesByInvoice.get(invoiceRowId) ?? []
                  }
                );
                if (outcome === "pushed") result.invoices.pushed += 1;
              } catch (invoiceError) {
                result.invoices.failed += 1;
                if (row.updatedAt) failedUpdatedAt.push(row.updatedAt);
                console.error(
                  `[RAMP SYNC] ${companyId}: invoice ${
                    row.invoiceId ?? invoiceRowId
                  } push failed`,
                  invoiceError
                );
              }
            }
          }

          const next = computeRepaymentCursor(allUpdatedAt, failedUpdatedAt);
          if (next) {
            await advanceRampCursor(
              client,
              companyId,
              "invoicePushUpdatedAt",
              next
            );
          }

          // 3. Archive-on-settlement: pushed bills whose invoice is now settled.
          const notArchived = billMappings.filter((m) => {
            const meta = (m.metadata ?? {}) as Record<string, unknown>;
            return meta.archived !== true && meta.rampPaid !== true;
          });
          if (notArchived.length > 0) {
            const settledIds = [...new Set(notArchived.map((m) => m.entityId))];
            const statuses = await client
              .from("purchaseInvoices")
              .select("id, status")
              .eq("companyId", companyId)
              .in("id", settledIds);
            const statusById = new Map(
              (statuses.data ?? []).map((row) => [row.id, row.status])
            );
            for (const m of notArchived) {
              const status = statusById.get(m.entityId);
              if (!status || !INVOICE_SETTLED_STATUSES.has(status)) continue;
              try {
                await archiveRampBillForInvoice(ctx.mapping, ramp, m);
                result.invoices.archived += 1;
              } catch (archiveError) {
                console.error(
                  `[RAMP SYNC] ${companyId}: bill archive for invoice ${m.entityId} failed`,
                  archiveError
                );
              }
            }
          }
        } catch (familyError) {
          console.error(
            `[RAMP SYNC] ${companyId}: invoice push / archive failed`,
            familyError
          );
        }
      }

      return result;
    });

    const totalFailed =
      cardResult.failed +
      transferResult.failed +
      cashbackResult.failed +
      billResult.failed +
      billPaymentResult.failed +
      reimbursementResult.failed +
      repaymentResult.failed +
      outboundResult.purchaseOrders.failed +
      outboundResult.invoices.failed;

    if (totalFailed > 0) {
      await step.run("ramp-notify-failures", async () => {
        const recipientId = integrationRow.data?.updatedBy;
        if (!recipientId || recipientId === "system")
          return { notified: false };
        try {
          await trigger("notify", {
            event: NotificationEvent.IntegrationSync,
            companyId,
            documentId: "ramp",
            title: "Ramp sync needs attention",
            body: `${totalFailed} item(s) failed to sync — review the Accounting tab in Ramp`,
            recipient: { type: "user", userId: recipientId }
          });
        } catch (notifyError) {
          console.error(
            `[RAMP SYNC] ${companyId}: failed to send sync-failure notification`,
            notifyError
          );
          return { notified: false };
        }
        return { notified: true };
      });
    }

    return {
      companyId,
      card: cardResult,
      transfers: transferResult,
      cashbacks: cashbackResult,
      bills: billResult,
      billPayments: billPaymentResult,
      reimbursements: reimbursementResult,
      repayments: repaymentResult,
      outbound: outboundResult
    };
  }
);
