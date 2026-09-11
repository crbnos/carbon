import type { Database } from "@carbon/database";
import {
  codeSelections,
  confirmSyncs,
  normalizeRampCardTransactionAmount,
  type RampCashback,
  type RampClient,
  type RampTransaction,
  type RampTransfer,
  resolveMerchantSupplier,
  scaleLinesToTotal
} from "@carbon/ee/ramp.server";
import { stageOrResumeRampCardTransaction } from "./ramp-sync-card-stage";
import { recordRampFamilyError } from "./ramp-sync-observability";
import {
  isRampEntityInScope,
  isRampInboundFamilyEnabled,
  rampEntityQuery
} from "./ramp-sync-policy";
import {
  cardTransactionsDeepLinkUrl,
  documentTypeForFile,
  type FailItem,
  type FamilyResult,
  getRampCurrencyDecimals,
  getRampExchangeRate,
  normalizeVerifiedMinorAmount,
  type RampSyncContext,
  type SyncItem,
  stripSpecialCharacters,
  verifyCostCenters
} from "./ramp-sync-shared";

/**
 * Download and attach a card transaction's Ramp receipts to the private bucket
 * + a `document` row. Non-fatal by contract — any failure is logged and
 * skipped so a missing receipt never blocks the sync.
 */
async function attachReceipts(
  ctx: RampSyncContext,
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
  ctx: RampSyncContext,
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
      const normalized = await normalizeVerifiedMinorAmount(
        ctx,
        item.amount,
        currencyCode,
        "Card transaction line amount",
        { allowDifferentCurrency: true }
      );
      if (!normalized.ok) return { error: normalized.error };
      lines.push({
        accountId,
        amount: Math.abs(normalized.value),
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

  const costCenterError = await verifyCostCenters(ctx, settledLines);
  if (costCenterError) return { error: costCenterError };

  return { lines: settledLines };
}

/**
 * Atomically stage a Draft `cardTransaction` (+ lines + Ramp mapping), post it,
 * and attach receipts. Ambiguous edge responses are accepted only when a
 * tenant-scoped reread proves the mapped document is Posted.
 */
export async function createAndPostTransaction(
  ctx: RampSyncContext,
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
    /** The merchant resolved to a Carbon supplier (Charge/Credit only). */
    supplierId: string | null;
    cardHolderName: string | null;
    memo: string | null;
    lines: BuiltLine[];
    receiptIds: string[];
    getReceipt: (id: string) => Promise<unknown>;
  }
): Promise<{ ok: SyncItem } | { fail: FailItem }> {
  let exchangeRate: number;
  try {
    exchangeRate = await getRampExchangeRate(ctx, args.currencyCode);
  } catch (error) {
    return {
      fail: {
        id: args.rampId,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }

  let staged: Awaited<ReturnType<typeof stageOrResumeRampCardTransaction>>;
  try {
    staged = await stageOrResumeRampCardTransaction(ctx.db, {
      ...args,
      companyId: ctx.companyId,
      actorId: "system",
      exchangeRate
    });
  } catch (error) {
    return {
      fail: {
        id: args.rampId,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
  if (staged.status === "Voided") {
    return {
      fail: {
        id: args.rampId,
        message: "Mapped Ramp card transaction is Voided in Carbon"
      }
    };
  }

  let postError: unknown;
  if (staged.status === "Draft") {
    const posted = await ctx.client.functions.invoke("post-card-transaction", {
      body: {
        type: "post",
        cardTransactionId: staged.cardTransactionId,
        userId: "system",
        companyId: ctx.companyId
      }
    });
    postError = posted.error;
  }

  const observed = await ctx.client
    .from("cardTransaction")
    .select("status")
    .eq("id", staged.cardTransactionId)
    .eq("companyId", ctx.companyId)
    .maybeSingle();
  if (observed.error || observed.data?.status !== "Posted") {
    const message = postError
      ? postError instanceof Error
        ? postError.message
        : String(postError)
      : (observed.error?.message ??
        "Ramp card transaction is not observably Posted in Carbon");
    return { fail: { id: args.rampId, message } };
  }

  await attachReceipts(ctx, {
    cardTransactionId: staged.cardTransactionId,
    receiptIds: args.receiptIds,
    getReceipt: args.getReceipt
  });

  return {
    ok: {
      id: args.rampId,
      referenceId: staged.readableId,
      deepLinkUrl: cardTransactionsDeepLinkUrl()
    }
  };
}

/** Batch mapping/status lookup so only finalized documents bypass staging. */
async function loadCardMappings(ctx: RampSyncContext, rampIds: string[]) {
  if (rampIds.length === 0)
    return new Map<
      string,
      {
        entityId: string;
        status: Database["public"]["Enums"]["cardTransactionStatus"] | null;
      }
    >();
  const rows = await ctx.db
    .selectFrom("externalIntegrationMapping as mapping")
    .leftJoin("cardTransaction as card", (join) =>
      join
        .onRef("card.id", "=", "mapping.entityId")
        .onRef("card.companyId", "=", "mapping.companyId")
    )
    .select(["mapping.externalId", "mapping.entityId", "card.status"])
    .where("mapping.companyId", "=", ctx.companyId)
    .where("mapping.integration", "=", "ramp")
    .where("mapping.entityType", "=", "cardTransaction")
    .where("mapping.externalId", "in", rampIds)
    .execute();
  return new Map(rows.map((row) => [row.externalId, row]));
}

/** Reconfirm only observably Posted documents; Drafts must be restaged first. */
async function reconfirmMapped(
  ctx: RampSyncContext,
  mapped: Array<{ rampId: string; entityId: string }>
): Promise<{ successful: SyncItem[]; failed: FailItem[] }> {
  if (mapped.length === 0) return { successful: [], failed: [] };
  const entityIds = [...new Set(mapped.map((m) => m.entityId))];
  const { data, error } = await ctx.client
    .from("cardTransaction")
    .select("id, cardTransactionId, status")
    .eq("companyId", ctx.companyId)
    .in("id", entityIds);
  if (error) {
    return {
      successful: [],
      failed: mapped.map(({ rampId }) => ({
        id: rampId,
        message: error.message
      }))
    };
  }
  const rowsById = new Map((data ?? []).map((row) => [row.id, row]));
  const url = cardTransactionsDeepLinkUrl();
  const successful: SyncItem[] = [];
  const failed: FailItem[] = [];
  for (const item of mapped) {
    const row = rowsById.get(item.entityId);
    if (!row) {
      failed.push({
        id: item.rampId,
        message: "Mapped Ramp card transaction no longer exists"
      });
      continue;
    }
    if (row.status !== "Posted") {
      failed.push({
        id: item.rampId,
        message: `Mapped Ramp card transaction is ${row.status} in Carbon`
      });
      continue;
    }
    successful.push({
      id: item.rampId,
      referenceId: row.cardTransactionId,
      deepLinkUrl: url
    });
  }
  return { successful, failed };
}

export async function syncRampCardTransactions(
  ctx: RampSyncContext,
  ramp: RampClient,
  entityId: string | undefined,
  cardLiabilityAccountId: string | undefined
): Promise<FamilyResult> {
  const { client, companyId, metadata } = ctx;
  const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
  if (!isRampInboundFamilyEnabled("transactions", metadata.sync)) {
    return result;
  }
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
      ...rampEntityQuery(entityId)
    })) {
      const mappings = await loadCardMappings(
        ctx,
        page.map((tx) => tx.id)
      );
      for (const tx of page as RampTransaction[]) {
        if (!isRampEntityInScope(entityId, tx.entity_id)) continue;
        const existing = mappings.get(tx.id);
        if (existing && existing.status !== "Draft") {
          mapped.push({ rampId: tx.id, entityId: existing.entityId });
          continue;
        }

        const currencyCode =
          tx.entity_amount?.currency ??
          tx.currency_code ??
          tx.currency ??
          ctx.baseCurrency;
        let decimals: number;
        try {
          decimals = await getRampCurrencyDecimals(ctx, currencyCode);
        } catch (error) {
          failed.push({
            id: tx.id,
            message: error instanceof Error ? error.message : String(error)
          });
          continue;
        }
        // Prefer `entity_amount.value` (signed integer minor units / cents)
        // — the non-deprecated settlement amount per the Ramp OpenAPI spec.
        // The top-level `amount` is DEPRECATED and a major-unit (dollar)
        // float, so reading it as minor units understated every charge 100×.
        // Fall back to it only when entity_amount is absent (rare: no valid
        // settlement currency). Verified 2026-08-28 against the spec.
        const normalizedAmount = normalizeRampCardTransactionAmount({
          entityAmount: tx.entity_amount,
          deprecatedMajorAmount: tx.amount,
          currencyCode,
          decimals
        });
        if (!normalizedAmount.ok) {
          failed.push({ id: tx.id, message: normalizedAmount.error });
          continue;
        }
        const signedAmount = normalizedAmount.value;
        const isCredit =
          signedAmount < 0 || Boolean(tx.original_transaction_id);
        const headerAmount = Math.abs(signedAmount);

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

        // The merchant becomes a Carbon supplier so the charge can carry a
        // vendor to the accounting provider. A transaction with no merchant
        // name is still posted (supplierId null) — the charge syncer then
        // leaves it as a journal entry with a visible reason.
        let supplierId: string | null = null;
        if (tx.merchant_name) {
          try {
            supplierId = await resolveMerchantSupplier(
              ctx.client,
              ctx.db,
              ctx.companyId,
              { id: tx.merchant_id ?? null, name: tx.merchant_name }
            );
          } catch (supplierError) {
            failed.push({
              id: tx.id,
              message: `Could not resolve merchant "${tx.merchant_name}" to a supplier: ${
                supplierError instanceof Error
                  ? supplierError.message
                  : String(supplierError)
              }`
            });
            continue;
          }
        }

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
          supplierId,
          cardHolderName: holder,
          memo: tx.memo ?? null,
          lines: built.lines,
          receiptIds: tx.receipts ?? [],
          getReceipt: (id) => ramp.getReceipt(id)
        });
        if ("ok" in outcome) {
          successful.push(outcome.ok);
          if (existing) result.reconfirmed++;
        } else failed.push(outcome.fail);
      }
    }
  } catch (familyError) {
    console.error(
      `[RAMP SYNC] ${companyId}: card transactions drain failed`,
      familyError
    );
    recordRampFamilyError(result, familyError);
  }

  const reconfirmed = await reconfirmMapped(ctx, mapped);
  successful.push(...reconfirmed.successful);
  failed.push(...reconfirmed.failed);

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
    result.confirmError =
      confirmError instanceof Error
        ? confirmError.message
        : String(confirmError);
  }

  result.reconfirmed += reconfirmed.successful.length;
  result.created = successful.length - result.reconfirmed;
  result.failed += failed.length;
  return result;
}

export async function syncRampTransfers(
  ctx: RampSyncContext,
  ramp: RampClient,
  entityId: string | undefined,
  cardLiabilityAccountId: string | undefined
): Promise<FamilyResult> {
  const { client, companyId, metadata } = ctx;
  const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
  if (!isRampInboundFamilyEnabled("transfers", metadata.sync)) {
    return result;
  }
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
      const mappings = await loadCardMappings(
        ctx,
        page.map((transfer) => transfer.id)
      );
      for (const transfer of page as RampTransfer[]) {
        if (!isRampEntityInScope(entityId, transfer.entity_id)) continue;
        const existing = mappings.get(transfer.id);
        if (existing && existing.status !== "Draft") {
          mapped.push({ rampId: transfer.id, entityId: existing.entityId });
          continue;
        }

        const currencyCode = transfer.currency_code ?? ctx.baseCurrency;
        const normalizedAmount = await normalizeVerifiedMinorAmount(
          ctx,
          transfer.amount,
          currencyCode,
          "Transfer amount"
        );
        if (!normalizedAmount.ok) {
          failed.push({
            id: transfer.id,
            message: normalizedAmount.error
          });
          continue;
        }
        const amount = Math.abs(normalizedAmount.value);
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
          supplierId: null,
          cardHolderName: null,
          memo: null,
          lines: [],
          receiptIds: [],
          getReceipt: (id) => ramp.getReceipt(id)
        });
        if ("ok" in outcome) {
          successful.push(outcome.ok);
          if (existing) result.reconfirmed++;
        } else failed.push(outcome.fail);
      }
    }
  } catch (familyError) {
    console.error(
      `[RAMP SYNC] ${companyId}: transfers drain failed`,
      familyError
    );
    recordRampFamilyError(result, familyError);
  }

  const reconfirmed = await reconfirmMapped(ctx, mapped);
  successful.push(...reconfirmed.successful);
  failed.push(...reconfirmed.failed);

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
    result.confirmError =
      confirmError instanceof Error
        ? confirmError.message
        : String(confirmError);
  }

  result.reconfirmed += reconfirmed.successful.length;
  result.created = successful.length - result.reconfirmed;
  result.failed += failed.length;
  return result;
}

export async function syncRampCashbacks(
  ctx: RampSyncContext,
  ramp: RampClient,
  entityId: string | undefined,
  cardLiabilityAccountId: string | undefined
): Promise<FamilyResult> {
  const { client, companyId, metadata } = ctx;
  const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
  if (!isRampInboundFamilyEnabled("cashbacks", metadata.sync)) {
    return result;
  }
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
      const mappings = await loadCardMappings(
        ctx,
        page.map((cashback) => cashback.id)
      );
      for (const cashback of page as RampCashback[]) {
        if (!isRampEntityInScope(entityId, cashback.entity_id)) continue;
        const existing = mappings.get(cashback.id);
        if (existing && existing.status !== "Draft") {
          mapped.push({ rampId: cashback.id, entityId: existing.entityId });
          continue;
        }

        const currencyCode = cashback.currency_code ?? ctx.baseCurrency;
        const normalizedAmount = await normalizeVerifiedMinorAmount(
          ctx,
          cashback.amount,
          currencyCode,
          "Cashback amount"
        );
        if (!normalizedAmount.ok) {
          failed.push({
            id: cashback.id,
            message: normalizedAmount.error
          });
          continue;
        }
        const amount = Math.abs(normalizedAmount.value);
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
          supplierId: null,
          cardHolderName: null,
          memo: null,
          lines: [],
          receiptIds: [],
          getReceipt: (id) => ramp.getReceipt(id)
        });
        if ("ok" in outcome) {
          successful.push(outcome.ok);
          if (existing) result.reconfirmed++;
        } else failed.push(outcome.fail);
      }
    }
  } catch (familyError) {
    console.error(
      `[RAMP SYNC] ${companyId}: cashbacks drain failed`,
      familyError
    );
    recordRampFamilyError(result, familyError);
  }

  const reconfirmed = await reconfirmMapped(ctx, mapped);
  successful.push(...reconfirmed.successful);
  failed.push(...reconfirmed.failed);

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
    result.confirmError =
      confirmError instanceof Error
        ? confirmError.message
        : String(confirmError);
  }

  result.reconfirmed += reconfirmed.successful.length;
  result.created = successful.length - result.reconfirmed;
  result.failed += failed.length;
  return result;
}
