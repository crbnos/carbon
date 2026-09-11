import {
  codeSelections,
  confirmSyncs,
  type RampBill,
  type RampClient,
  resolveRampSupplier
} from "@carbon/ee/ramp.server";
import { round } from "@carbon/utils";
import {
  isPostedRampBill,
  type RampBillLine,
  stageOrResumeRampBill
} from "./ramp-sync-bill-stage";
import { syncRampBillPayment } from "./ramp-sync-payment";
import {
  isRampEntityInScope,
  isRampInboundFamilyEnabled
} from "./ramp-sync-policy";
import {
  documentTypeForFile,
  type FailItem,
  type FamilyResult,
  getRampCurrencyDecimals,
  getRampExchangeRate,
  invoiceDeepLinkUrl,
  normalizeVerifiedMinorAmount,
  type RampSyncContext,
  type SyncItem,
  stripSpecialCharacters,
  verifyCostCenters
} from "./ramp-sync-shared";

/** Ramp bill status that means the bill has been fully paid. */
const BILL_PAID_STATUS = "PAID";

type BuiltInvoiceLine = RampBillLine;

/**
 * GET /bills exposes vendor.id/name; retain legacy business_name compatibility.
 */
function extractRampVendor(bill: RampBill): { id?: string; name: string } {
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
  ctx: RampSyncContext,
  bill: RampBill,
  currencyCode: string
): Promise<{ lines: BuiltInvoiceLine[] } | { error: string }> {
  const uncoded =
    "Bill line is coded to an account Carbon doesn't recognize — recode the bill in Ramp";
  if (!ctx.companyGroupId)
    return { error: "Cannot verify bill accounts without a company group" };

  const items = [
    ...(bill.line_items ?? []),
    ...((Array.isArray(bill.inventory_line_items)
      ? bill.inventory_line_items
      : []) as NonNullable<RampBill["line_items"]>)
  ];
  if (items.length === 0) {
    return { error: "Bill has no line items to post" };
  }

  const lines: BuiltInvoiceLine[] = [];
  for (const item of items) {
    const { accountId, costCenterId } = codeSelections(
      item.accounting_field_selections
    );
    if (!accountId) return { error: uncoded };
    const normalized = await normalizeVerifiedMinorAmount(
      ctx,
      item.amount,
      currencyCode,
      "Bill line amount"
    );
    if (!normalized.ok) return { error: normalized.error };
    lines.push({
      accountId,
      costCenterId,
      amount: normalized.value,
      ...(typeof item.purchase_order_line_item_id === "string"
        ? { purchaseOrderLineId: item.purchase_order_line_item_id }
        : {}),
      ...(typeof item.quantity === "number" ? { quantity: item.quantity } : {}),
      description: item.memo ?? null
    });
  }

  // `account` (chart of accounts) is scoped by companyGroupId, NOT companyId —
  // it has no companyId column, so filtering by it errored and made every coded
  // bill fail "Failed to verify accounts". Mirror the card-transaction builder:
  // scope to the group (the ids are Carbon's pushed account.id, so group-scoping
  // is both correct and tenant-safe).
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
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

  const costCenterError = await verifyCostCenters(ctx, lines);
  if (costCenterError) return { error: costCenterError };

  return { lines };
}

/**
 * Claim only a Draft, then observe the stored outcome. The posting edge
 * function owns rollback; an ambiguous response must never re-draft a posted
 * invoice or start a second invocation while the first is still Pending.
 */
export async function postPurchaseInvoice(
  ctx: RampSyncContext,
  invoiceRowId: string
): Promise<{ readableId: string } | { fail: string }> {
  const info = await ctx.client
    .from("purchaseInvoice")
    .select("invoiceId, status")
    .eq("id", invoiceRowId)
    .eq("companyId", ctx.companyId)
    .single();
  if (info.error || !info.data) {
    return {
      fail: `Failed to read invoice: ${info.error?.message ?? "missing"}`
    };
  }
  const readableId = info.data.invoiceId;
  if (info.data.status === "Pending" || info.data.status === "Voided") {
    return {
      fail: `Invoice ${readableId} is ${info.data.status}, not ready to post`
    };
  }
  if (isPostedRampBill(info.data.status)) return { readableId };
  if (info.data.status !== "Draft")
    return { fail: `Invoice ${readableId} is not a posted bill` };

  const pending = await ctx.client
    .from("purchaseInvoice")
    .update({ status: "Pending" })
    .eq("id", invoiceRowId)
    .eq("companyId", ctx.companyId)
    .eq("status", "Draft")
    .select("id")
    .maybeSingle();
  if (pending.error || !pending.data) {
    return {
      fail: `Failed to claim Draft invoice: ${pending.error?.message ?? "invoice is no longer Draft"}`
    };
  }

  let postError: string | undefined;
  try {
    const posted = await ctx.client.functions.invoke("post-purchase-invoice", {
      body: {
        invoiceId: invoiceRowId,
        userId: "system",
        companyId: ctx.companyId
      }
    });
    postError = posted.error?.message;
  } catch (error) {
    postError = error instanceof Error ? error.message : String(error);
  }
  const observed = await ctx.client
    .from("purchaseInvoice")
    .select("status")
    .eq("id", invoiceRowId)
    .eq("companyId", ctx.companyId)
    .maybeSingle();
  if (
    observed.error ||
    !observed.data ||
    !isPostedRampBill(observed.data.status)
  ) {
    return {
      fail: `Invoice ${readableId} is ${observed.data?.status ?? "unobservable"}, not posted${postError ? `: ${postError}` : observed.error ? `: ${observed.error.message}` : ""}`
    };
  }
  return { readableId };
}

/**
 * Attach a bill's `invoice_urls` PDFs to the invoice's private bucket + document
 * rows. Non-fatal by contract — any failure is logged and skipped.
 */
async function attachBillDocuments(
  ctx: RampSyncContext,
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
  ctx: RampSyncContext,
  ramp: RampClient,
  bill: RampBill
): Promise<{ ok: SyncItem } | { skip: SyncItem } | { fail: FailItem }> {
  try {
    const vendorCredits = bill.applied_vendor_credits;
    if (Array.isArray(vendorCredits) && vendorCredits.length > 0) {
      throw new Error(
        "Bill applies vendor credits — vendor credits not supported yet"
      );
    }
    const vendor = extractRampVendor(bill);
    if (!vendor.name)
      throw new Error("Bill has no vendor — cannot resolve a supplier");
    const supplierId = await resolveRampSupplier(
      ctx.client,
      ctx.companyId,
      vendor,
      "system",
      ctx.db
    );
    // GET /bills returns CurrencyAmount; its currency is authoritative, not the
    // company's base currency (the older flat currency_code is optional).
    const wireAmount = bill.amount as { currency_code?: string } | undefined;
    const currencyCode = wireAmount?.currency_code ?? bill.currency_code;
    if (!currencyCode) throw new Error("Ramp bill has no verified currency");
    const decimals = await getRampCurrencyDecimals(ctx, currencyCode);
    const exchangeRate = await getRampExchangeRate(ctx, currencyCode);
    const total = await normalizeVerifiedMinorAmount(
      ctx,
      bill.amount,
      currencyCode,
      "Bill total"
    );
    if (!total.ok) throw new Error(total.error);
    const built = await buildBillLines(ctx, bill, currencyCode);
    if ("error" in built) throw new Error(built.error);
    const difference = round(
      total.value - built.lines.reduce((sum, line) => sum + line.amount, 0),
      decimals
    );
    if (difference !== 0) {
      // Header charges can only use explicit, unambiguous bill coding. Never
      // choose an arbitrary account when the bill splits several dimensions.
      const coding = new Map(
        built.lines.map((line) => [
          JSON.stringify([line.accountId, line.costCenterId]),
          line
        ])
      );
      if (coding.size !== 1)
        throw new Error(
          "Bill total differs from its lines and adjustment coding is ambiguous"
        );
      const line = [...coding.values()][0]!;
      built.lines.push({
        accountId: line.accountId,
        costCenterId: line.costCenterId,
        amount: difference,
        description: "Ramp bill total adjustment"
      });
    }

    // GET uses purchase_order_id; retain plural compatibility with persisted
    // create payloads. Multi-PO bills are standalone and retain a clear memo.
    const rampPoIds = [
      ...new Set([
        ...(bill.purchase_order_ids ?? []),
        ...(typeof bill.purchase_order_id === "string"
          ? [bill.purchase_order_id]
          : [])
      ])
    ];
    const purchaseOrderId =
      rampPoIds.length === 1
        ? await ctx.mapping.getEntityId("ramp", rampPoIds[0]!, "purchaseOrder")
        : null;
    if (purchaseOrderId) {
      const references = built.lines.filter((line) => line.purchaseOrderLineId);
      if (references.length) {
        // Carbon pushes PO lines with external_id = Carbon purchaseOrderLine.id.
        // Resolve Ramp's line UUID through that verified external reference.
        const remotePo = await ramp.request<{
          line_items?: Array<{ id: string; external_id?: string | null }>;
        }>(
          "GET",
          `/developer/v1/purchase-orders/${encodeURIComponent(rampPoIds[0]!)}`
        );
        const ids = new Map(
          (remotePo.line_items ?? []).map((line) => [line.id, line.external_id])
        );
        for (const line of references) {
          const id = ids.get(line.purchaseOrderLineId!);
          if (id) line.purchaseOrderLineId = id;
          else delete line.purchaseOrderLineId; // explicitly coded G/L fallback
        }
      }
    } else {
      for (const line of built.lines) delete line.purchaseOrderLineId;
    }
    const staged = await stageOrResumeRampBill(ctx.db, {
      companyId: ctx.companyId,
      sourceId: bill.id,
      supplierId,
      supplierReference: (bill.invoice_number ?? "").trim(),
      currencyCode,
      exchangeRate,
      decimals,
      totalAmount: total.value,
      dateIssued: bill.issued_at?.slice(0, 10) ?? null,
      dateDue: bill.due_at?.slice(0, 10) ?? null,
      lines: built.lines,
      purchaseOrderId: purchaseOrderId ?? undefined,
      carbonBornInvoiceId: bill.remote_id,
      ...(rampPoIds.length > 1
        ? {
            memo: `Ramp bill ${bill.id} spans ${rampPoIds.length} purchase orders; posted standalone.`
          }
        : {})
    });
    const posted = await postPurchaseInvoice(ctx, staged.invoiceRowId);
    if ("fail" in posted) throw new Error(posted.fail);
    if (staged.status === "Draft") {
      await attachBillDocuments(ctx, {
        invoiceRowId: staged.invoiceRowId,
        urls: bill.invoice_urls ?? []
      });
    }
    const item = {
      id: bill.id,
      referenceId: posted.readableId,
      deepLinkUrl: invoiceDeepLinkUrl(staged.invoiceRowId)
    };
    return staged.status === "Draft" ? { ok: item } : { skip: item };
  } catch (error) {
    return {
      fail: {
        id: bill.id,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export async function syncRampBills(
  ctx: RampSyncContext,
  ramp: RampClient,
  entityId: string | undefined
): Promise<FamilyResult> {
  const { client, companyId, metadata } = ctx;
  const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
  if (!isRampInboundFamilyEnabled("bills", metadata.sync)) return result;

  const successful: SyncItem[] = [];
  const failed: FailItem[] = [];
  let reconfirmed = 0;

  try {
    for await (const page of ramp.listBills({
      sync_ready: true,
      sync_status: "NOT_SYNCED"
    })) {
      for (const bill of page as RampBill[]) {
        if (!isRampEntityInScope(entityId, bill.entity_id)) continue;
        const outcome = await syncBill(ctx, ramp, bill);
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
    console.error(`[RAMP SYNC] ${companyId}: bills drain failed`, familyError);
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
    result.confirmError =
      confirmError instanceof Error
        ? confirmError.message
        : String(confirmError);
  }

  result.created = successful.length - reconfirmed;
  result.reconfirmed = reconfirmed;
  result.failed = failed.length;
  return result;
}

export async function syncRampBillPayments(
  ctx: RampSyncContext,
  ramp: RampClient,
  entityId: string | undefined
): Promise<FamilyResult> {
  const { client, companyId, metadata } = ctx;
  const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
  // Bill payments ride the same gate as bills (no separate flag).
  if (!isRampInboundFamilyEnabled("billPayments", metadata.sync)) {
    return result;
  }
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
        if (!isRampEntityInScope(entityId, bill.entity_id)) continue;
        // TODO(task-1): confirm bill.status vs payment.status for PAID.
        if (bill.status !== BILL_PAID_STATUS) continue;
        const payment = bill.payment;
        if (!payment) continue;

        const outcome = await syncRampBillPayment(
          {
            companyId: ctx.companyId,
            baseCurrency: ctx.baseCurrency,
            statementBankAccountId: metadata.statementBankAccountId,
            db: ctx.db,
            client: ctx.client,
            getMappedInvoiceId: (billRemoteId) =>
              ctx.mapping.getEntityId("ramp", billRemoteId, "bill"),
            normalizeAmount: (value, currencyCode, label) =>
              normalizeVerifiedMinorAmount(ctx, value, currencyCode, label),
            getExchangeRate: (currencyCode) =>
              getRampExchangeRate(ctx, currencyCode),
            invoiceDeepLinkUrl
          },
          bill,
          payment
        );
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
    result.confirmError =
      confirmError instanceof Error
        ? confirmError.message
        : String(confirmError);
  }

  result.created = successful.length - reconfirmed;
  result.reconfirmed = reconfirmed;
  result.failed = failed.length;
  return result;
}
