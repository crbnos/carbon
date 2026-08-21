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
  confirmSyncs,
  fromMinorUnits,
  getRampIntegration,
  type RampBill,
  type RampBillPayment,
  type RampCashback,
  type RampCurrencyAmount,
  type RampIntegrationMetadata,
  type RampTransaction,
  type RampTransfer,
  resolveRampSupplier
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
};

/**
 * Resolve a coded GL account + cost center from a Ramp accounting-field-selection
 * list. The first GL_ACCOUNT selection wins for the account; the first
 * COST_CENTER selection wins for the cost center. `external_id` is the Carbon id
 * Carbon pushed (account.id / costCenter.id).
 */
function codeSelections(
  selections:
    | Array<{ external_id?: string | null; type?: string }>
    | null
    | undefined
): { accountId: string | null; costCenterId: string | null } {
  let accountId: string | null = null;
  let costCenterId: string | null = null;
  for (const selection of selections ?? []) {
    if (!selection.external_id) continue;
    if (selection.type === GL_ACCOUNT && !accountId) {
      accountId = selection.external_id;
    } else if (selection.type === COST_CENTER && !costCenterId) {
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

/** Extract the integer minor-unit amount from a Ramp money value. */
function toMinorUnits(
  value: number | RampCurrencyAmount | null | undefined
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  return value.amount;
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

  // Verify every coded account really exists in this company (one query).
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
        .eq("id", cardTransactionId);
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
      .eq("id", cardTransactionId);
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
    .eq("id", invoiceRowId);
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
      .eq("id", invoiceRowId);
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

  // Duplicate guard: same supplier + supplierReference already invoiced.
  if (invoiceNumber) {
    const dup = await ctx.client
      .from("purchaseInvoice")
      .select("id, invoiceId")
      .eq("companyId", ctx.companyId)
      .eq("supplierId", supplierId)
      .eq("supplierReference", invoiceNumber)
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
      await ctx.client.from("purchaseInvoice").delete().eq("id", invoiceRowId);
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

  const seq = await ctx.client.rpc("get_next_sequence", {
    sequence_name: "payment",
    company_id: ctx.companyId
  });
  if (seq.error || !seq.data) {
    return {
      fail: {
        id: paymentRampId,
        message: `Failed to generate payment number: ${
          seq.error?.message ?? "unknown error"
        }`
      }
    };
  }
  const readablePaymentId = seq.data as string;
  const invoiceExchangeRate = invoice.data.exchangeRate ?? 1;

  const paymentRow = await ctx.client
    .from("payment")
    .insert({
      paymentId: readablePaymentId,
      paymentType: "Disbursement",
      status: "Draft",
      supplierId: invoice.data.supplierId,
      paymentDate,
      postingDate: paymentDate,
      currencyCode,
      exchangeRate: invoiceExchangeRate,
      totalAmount: amount,
      bankAccount: ctx.metadata.statementBankAccountId as string,
      memo: `Ramp bill payment ${paymentRampId}`,
      companyId: ctx.companyId,
      createdBy: "system"
    })
    .select("id")
    .single();
  if (paymentRow.error || !paymentRow.data) {
    return {
      fail: {
        id: paymentRampId,
        message: `Failed to create payment: ${
          paymentRow.error?.message ?? "unknown error"
        }`
      }
    };
  }
  const paymentRowId = paymentRow.data.id;

  const settlement = await ctx.client.from("invoiceSettlement").insert({
    paymentId: paymentRowId,
    targetPurchaseInvoiceId: invoiceId,
    appliedAmount: amount,
    discountAmount: 0,
    writeOffAmount: 0,
    sourceExchangeRate: 1,
    targetExchangeRate: invoiceExchangeRate,
    appliedDate: paymentDate,
    companyId: ctx.companyId,
    createdBy: "system"
  });
  if (settlement.error) {
    await ctx.client.from("payment").delete().eq("id", paymentRowId);
    return {
      fail: {
        id: paymentRampId,
        message: `Failed to create invoice settlement: ${settlement.error.message}`
      }
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
      .eq("paymentId", paymentRowId);
    await ctx.client.from("payment").delete().eq("id", paymentRowId);
    const message =
      posted.error instanceof Error
        ? posted.error.message
        : String(posted.error);
    return { fail: { id: paymentRampId, message } };
  }

  await ctx.mapping.link("payment", paymentRowId, "ramp", paymentRampId, {
    createdBy: "system"
  });

  return {
    ok: {
      id: paymentRampId,
      referenceId: readablePaymentId,
      deepLinkUrl: invoiceDeepLinkUrl(invoiceId)
    }
  };
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
      .select("updatedBy")
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
      decimalsCache: new Map()
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
              tx.currency_code ?? tx.currency ?? ctx.baseCurrency;
            const decimals = await getDecimals(ctx, currencyCode);
            const rawMinor = tx.amount ?? 0;
            // TODO(task-1): confirm `amount` is minor units (not a decimal).
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
              const info = await ctx.client
                .from("purchaseInvoice")
                .select("invoiceId")
                .eq("id", existing)
                .eq("companyId", companyId)
                .maybeSingle();
              successful.push({
                id: bill.id,
                referenceId: info.data?.invoiceId ?? existing,
                deepLinkUrl: invoiceDeepLinkUrl(existing)
              });
              reconfirmed += 1;
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

    // Tasks 9–10 add reimbursements / repayments / outbound step.run blocks here.

    const totalFailed =
      cardResult.failed +
      transferResult.failed +
      cashbackResult.failed +
      billResult.failed +
      billPaymentResult.failed;

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
      billPayments: billPaymentResult
    };
  }
);
