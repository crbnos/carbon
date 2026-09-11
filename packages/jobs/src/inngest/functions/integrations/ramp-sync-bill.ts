import {
  codeSelections,
  confirmSyncs,
  type RampBill,
  type RampClient,
  resolveRampSupplier
} from "@carbon/ee/ramp.server";
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
// TODO(task-1): confirm Ramp's paid bill status string.
const BILL_PAID_STATUS = "PAID";

async function reconfirmMappedInvoices(
  ctx: RampSyncContext,
  mapped: Array<{ rampId: string; entityId: string }>
): Promise<SyncItem[]> {
  if (mapped.length === 0) return [];
  const entityIds = [...new Set(mapped.map((item) => item.entityId))];
  const { data } = await ctx.client
    .from("purchaseInvoice")
    .select("id, invoiceId")
    .eq("companyId", ctx.companyId)
    .in("id", entityIds);
  const readableById = new Map(
    (data ?? []).map((row) => [row.id, row.invoiceId])
  );
  return mapped.map((item) => ({
    id: item.rampId,
    referenceId: readableById.get(item.entityId) ?? item.entityId,
    deepLinkUrl: invoiceDeepLinkUrl(item.entityId)
  }));
}

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
  ctx: RampSyncContext,
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
      amount: Math.abs(normalized.value),
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
 * The delivery row every purchase invoice carries (`purchaseInvoiceDelivery`,
 * PK = the invoice id). The app creates it alongside the header
 * (`invoicing.service.ts` upsertPurchaseInvoice); `post-purchase-invoice`
 * reads it with `.single()` and refuses to post without it ("Failed to fetch
 * purchase invoice delivery" — hit live 2026-09-10 replaying this insert
 * shape by hand). A Ramp bill/reimbursement has no shipping, so the row is
 * bare. Returns an error message, or null when the row exists.
 */
async function createPurchaseInvoiceDelivery(
  ctx: RampSyncContext,
  invoiceRowId: string
): Promise<string | null> {
  const delivery = await ctx.client.from("purchaseInvoiceDelivery").insert({
    id: invoiceRowId,
    supplierShippingCost: 0,
    companyId: ctx.companyId
  });
  return delivery.error
    ? `Failed to create purchase invoice delivery: ${delivery.error.message}`
    : null;
}

/**
 * Set a Draft purchase invoice to Pending and post it through the
 * `post-purchase-invoice` edge function. Reverts to Draft on error (clone of the
 * $invoiceId.post route). Returns the readable invoice id on success.
 */
export async function postPurchaseInvoice(
  ctx: RampSyncContext,
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
  let decimals: number;
  let exchangeRate: number;
  try {
    decimals = await getRampCurrencyDecimals(ctx, currencyCode);
    exchangeRate = await getRampExchangeRate(ctx, currencyCode);
  } catch (error) {
    return {
      fail: {
        id: bill.id,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
  // Foreign-per-base rate for the bill's currency; the generated
  // purchaseInvoiceLine.unitPrice/totalAmount = supplierUnitPrice / exchangeRate
  // is what post-purchase-invoice posts to the GL in base currency.
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
        exchangeRate,
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

    const deliveryError = await createPurchaseInvoiceDelivery(
      ctx,
      invoiceRowId
    );
    if (deliveryError) {
      await ctx.client
        .from("purchaseInvoice")
        .delete()
        .eq("id", invoiceRowId)
        .eq("companyId", ctx.companyId);
      return { fail: { id: bill.id, message: deliveryError } };
    }

    const lineRows = built.lines.map((line, lineIndex) => ({
      invoiceId: invoiceRowId,
      invoiceLineType: "G/L Account" as const,
      accountId: line.accountId,
      costCenterId: line.costCenterId,
      description: line.description,
      quantity: 1,
      // Document-currency amount; the generated unitPrice/totalAmount divide by
      // exchangeRate to post the GL in base currency.
      supplierUnitPrice: line.amount,
      exchangeRate,
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
  const mapped: Array<{ rampId: string; entityId: string }> = [];
  let reconfirmed = 0;

  try {
    for await (const page of ramp.listBills({
      sync_ready: true,
      // TODO(task-1): confirm the NOT_SYNCED sync_status string + sync_ready param.
      sync_status: "NOT_SYNCED"
    })) {
      for (const bill of page as RampBill[]) {
        if (!isRampEntityInScope(entityId, bill.entity_id)) continue;
        const existing = await ctx.mapping.getEntityId("ramp", bill.id, "bill");
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
    console.error(`[RAMP SYNC] ${companyId}: bills drain failed`, familyError);
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
