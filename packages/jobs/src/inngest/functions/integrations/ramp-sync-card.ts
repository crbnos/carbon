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
import { getCompanyPrivateBucket } from "@carbon/utils";
import { stageOrResumeRampCardTransaction } from "./ramp-sync-card-stage";
import { recordRampFamilyError } from "./ramp-sync-observability";
import {
  isRampEntityInScope,
  isRampInboundFamilyEnabled,
  type RampInboundFamily,
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
  verifyCostCenters,
  verifyProjects
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
        .from(getCompanyPrivateBucket(ctx.companyId))
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
  projectId: string | null;
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
      const { accountId, costCenterId, projectId } = codeSelections(
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
        projectId,
        description: item.memo ?? null
      });
    }
  } else {
    // Fallback for a transaction Ramp returned with no `line_items[]`. Real Ramp
    // data carries coding on `line_items[].accounting_field_selections[]`; the
    // top-level `accounting_field_selections` is always `[]` (verified 2026-08-28),
    // so this path fails closed as `uncoded` rather than silently posting a
    // miscoded charge. Kept as a defensive read in case Ramp ever populates it.
    const { accountId, costCenterId, projectId } = codeSelections(
      tx.accounting_field_selections
    );
    if (!accountId) return { error: uncoded };
    lines.push({
      accountId,
      amount: headerAmount,
      costCenterId,
      projectId,
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

  const projectError = await verifyProjects(ctx, settledLines);
  if (projectError) return { error: projectError };

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

/** Fields every card-family list row shares — enough to scope and map it. */
type RampCardListItem = { id: string; entity_id?: string | null };

/**
 * Whether a family may run, plus the two accounts every produced
 * `cardTransaction` needs. `proceed: false` is a silent (or self-logged) skip.
 */
type CardFamilyGate =
  | { proceed: false }
  | { proceed: true; cardAccountId: string; offsetAccountId: string | null };

/** The per-family differences the shared driver is parameterized by. */
type CardFamilyConfig<TItem extends RampCardListItem> = {
  /** Sync toggle key (`metadata.sync.pull*`). */
  family: RampInboundFamily;
  /** Human name used in the drain-failure log line. */
  label: string;
  /** Ramp confirm `sync_type` for this family. */
  syncType: string;
  /** Required-account gate; resolves the card + offset accounts. */
  gate: (
    ctx: RampSyncContext,
    cardLiabilityAccountId: string | undefined
  ) => CardFamilyGate;
  /** The family's SYNC_READY listing. */
  list: (
    ramp: RampClient,
    entityId: string | undefined
  ) => AsyncIterable<unknown[]>;
  /** Build (and post) one row into a `cardTransaction`. */
  buildOutcome: (
    ctx: RampSyncContext,
    item: TItem,
    ramp: RampClient,
    accounts: { cardAccountId: string; offsetAccountId: string | null }
  ) => Promise<{ ok: SyncItem } | { fail: FailItem }>;
};

/**
 * The shared skeleton for every card family: page loop → mapping load → mapped
 * short-circuit → per-item build/post → reconfirm-outside-drain → confirm →
 * result tally. Per-family behavior comes entirely from `config`; failure
 * isolation, cursor/mapping idempotency, and the confirm contract are identical
 * across all three families and live here once.
 */
async function syncRampCardFamily<TItem extends RampCardListItem>(
  ctx: RampSyncContext,
  ramp: RampClient,
  entityId: string | undefined,
  cardLiabilityAccountId: string | undefined,
  config: CardFamilyConfig<TItem>
): Promise<FamilyResult> {
  const { client, companyId, metadata } = ctx;
  const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
  if (!isRampInboundFamilyEnabled(config.family, metadata.sync)) {
    return result;
  }
  const gate = config.gate(ctx, cardLiabilityAccountId);
  if (!gate.proceed) {
    return result;
  }
  const accounts = {
    cardAccountId: gate.cardAccountId,
    offsetAccountId: gate.offsetAccountId
  };

  const successful: SyncItem[] = [];
  const failed: FailItem[] = [];
  const mapped: Array<{ rampId: string; entityId: string }> = [];

  try {
    for await (const page of config.list(ramp, entityId)) {
      const items = page as TItem[];
      const mappings = await loadCardMappings(
        ctx,
        items.map((item) => item.id)
      );
      for (const item of items) {
        if (!isRampEntityInScope(entityId, item.entity_id)) continue;
        const existing = mappings.get(item.id);
        if (existing && existing.status !== "Draft") {
          mapped.push({ rampId: item.id, entityId: existing.entityId });
          continue;
        }

        const outcome = await config.buildOutcome(ctx, item, ramp, accounts);
        if ("ok" in outcome) {
          successful.push(outcome.ok);
          if (existing) result.reconfirmed++;
        } else failed.push(outcome.fail);
      }
    }
  } catch (familyError) {
    console.error(
      `[RAMP SYNC] ${companyId}: ${config.label} drain failed`,
      familyError
    );
    recordRampFamilyError(result, familyError);
  }

  const reconfirmed = await reconfirmMapped(ctx, mapped);
  successful.push(...reconfirmed.successful);
  failed.push(...reconfirmed.failed);

  try {
    await confirmSyncs(client, companyId, {
      syncType: config.syncType,
      successful,
      failed
    });
  } catch (confirmError) {
    console.error(
      `[RAMP SYNC] ${companyId}: ${config.syncType} confirm failed`,
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

/**
 * Build one `cardTransaction` from a Ramp card transaction — the family with
 * coded lines, a merchant supplier, and settlement-amount handling.
 */
async function buildTransactionOutcome(
  ctx: RampSyncContext,
  tx: RampTransaction,
  ramp: RampClient,
  accounts: { cardAccountId: string; offsetAccountId: string | null }
): Promise<{ ok: SyncItem } | { fail: FailItem }> {
  const currencyCode =
    tx.entity_amount?.currency ??
    tx.currency_code ??
    tx.currency ??
    ctx.baseCurrency;
  let decimals: number;
  try {
    decimals = await getRampCurrencyDecimals(ctx, currencyCode);
  } catch (error) {
    return {
      fail: {
        id: tx.id,
        message: error instanceof Error ? error.message : String(error)
      }
    };
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
    return { fail: { id: tx.id, message: normalizedAmount.error } };
  }
  const signedAmount = normalizedAmount.value;
  const isCredit = signedAmount < 0 || Boolean(tx.original_transaction_id);
  const headerAmount = Math.abs(signedAmount);

  const built = await buildTransactionLines(
    ctx,
    tx,
    currencyCode,
    decimals,
    headerAmount
  );
  if ("error" in built) {
    return { fail: { id: tx.id, message: built.error } };
  }

  const transactionDate = (
    tx.user_transaction_time ??
    tx.accounting_date ??
    tx.settlement_date
  )?.slice(0, 10);
  if (!transactionDate) {
    return { fail: { id: tx.id, message: "Transaction has no usable date" } };
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
      return {
        fail: {
          id: tx.id,
          message: `Could not resolve merchant "${tx.merchant_name}" to a supplier: ${
            supplierError instanceof Error
              ? supplierError.message
              : String(supplierError)
          }`
        }
      };
    }
  }

  return createAndPostTransaction(ctx, {
    rampId: tx.id,
    type: isCredit ? "Credit" : "Charge",
    amount: headerAmount,
    currencyCode,
    transactionDate,
    postingDate: tx.accounting_date?.slice(0, 10) ?? null,
    cardAccountId: accounts.cardAccountId,
    offsetAccountId: accounts.offsetAccountId,
    merchantName: tx.merchant_name ?? null,
    supplierId,
    cardHolderName: holder,
    memo: tx.memo ?? null,
    lines: built.lines,
    receiptIds: tx.receipts ?? [],
    getReceipt: (id) => ramp.getReceipt(id)
  });
}

/**
 * The two line-less card families (transfers → Payment, cashbacks → Cashback)
 * differ only by label and produced type; everything else is identical.
 */
function buildSimpleCardOutcome(family: {
  label: string;
  type: Database["public"]["Enums"]["cardTransactionType"];
}) {
  return async (
    ctx: RampSyncContext,
    item: RampTransfer | RampCashback,
    ramp: RampClient,
    accounts: { cardAccountId: string; offsetAccountId: string | null }
  ): Promise<{ ok: SyncItem } | { fail: FailItem }> => {
    const currencyCode = item.currency_code ?? ctx.baseCurrency;
    const normalizedAmount = await normalizeVerifiedMinorAmount(
      ctx,
      item.amount,
      currencyCode,
      `${family.label} amount`
    );
    if (!normalizedAmount.ok) {
      return { fail: { id: item.id, message: normalizedAmount.error } };
    }
    const amount = Math.abs(normalizedAmount.value);
    const transactionDate = item.created_at?.slice(0, 10);
    if (!transactionDate) {
      return {
        fail: { id: item.id, message: `${family.label} has no usable date` }
      };
    }

    return createAndPostTransaction(ctx, {
      rampId: item.id,
      type: family.type,
      amount,
      currencyCode,
      transactionDate,
      postingDate: transactionDate,
      cardAccountId: accounts.cardAccountId,
      offsetAccountId: accounts.offsetAccountId,
      merchantName: null,
      supplierId: null,
      cardHolderName: null,
      memo: null,
      lines: [],
      receiptIds: [],
      getReceipt: (id) => ramp.getReceipt(id)
    });
  };
}

export async function syncRampCardTransactions(
  ctx: RampSyncContext,
  ramp: RampClient,
  entityId: string | undefined,
  cardLiabilityAccountId: string | undefined
): Promise<FamilyResult> {
  return syncRampCardFamily<RampTransaction>(
    ctx,
    ramp,
    entityId,
    cardLiabilityAccountId,
    {
      family: "transactions",
      label: "card transactions",
      syncType: "TRANSACTION_SYNC",
      gate: (ctx, cardLiabilityAccountId) => {
        if (!cardLiabilityAccountId) {
          console.warn(
            `[RAMP SYNC] ${ctx.companyId}: no cardLiabilityAccountId configured — skipping card transactions`
          );
          return { proceed: false };
        }
        return {
          proceed: true,
          cardAccountId: cardLiabilityAccountId,
          offsetAccountId: null
        };
      },
      list: (ramp, entityId) =>
        ramp.listTransactions({
          sync_status: "SYNC_READY",
          ...rampEntityQuery(entityId)
        }),
      buildOutcome: buildTransactionOutcome
    }
  );
}

export async function syncRampTransfers(
  ctx: RampSyncContext,
  ramp: RampClient,
  entityId: string | undefined,
  cardLiabilityAccountId: string | undefined
): Promise<FamilyResult> {
  return syncRampCardFamily<RampTransfer>(
    ctx,
    ramp,
    entityId,
    cardLiabilityAccountId,
    {
      family: "transfers",
      label: "transfers",
      syncType: "TRANSFER_SYNC",
      gate: (ctx, cardLiabilityAccountId) => {
        if (!cardLiabilityAccountId || !ctx.metadata.statementBankAccountId) {
          return { proceed: false };
        }
        return {
          proceed: true,
          cardAccountId: cardLiabilityAccountId,
          offsetAccountId: ctx.metadata.statementBankAccountId
        };
      },
      list: (ramp) => ramp.listTransfers({ sync_status: "SYNC_READY" }),
      buildOutcome: buildSimpleCardOutcome({
        label: "Transfer",
        type: "Payment"
      })
    }
  );
}

export async function syncRampCashbacks(
  ctx: RampSyncContext,
  ramp: RampClient,
  entityId: string | undefined,
  cardLiabilityAccountId: string | undefined
): Promise<FamilyResult> {
  return syncRampCardFamily<RampCashback>(
    ctx,
    ramp,
    entityId,
    cardLiabilityAccountId,
    {
      family: "cashbacks",
      label: "cashbacks",
      syncType: "STATEMENT_CREDIT_SYNC",
      // Skip the family silently when no cashback income account is configured.
      gate: (ctx, cardLiabilityAccountId) => {
        if (!cardLiabilityAccountId || !ctx.metadata.cashbackIncomeAccountId) {
          return { proceed: false };
        }
        return {
          proceed: true,
          cardAccountId: cardLiabilityAccountId,
          offsetAccountId: ctx.metadata.cashbackIncomeAccountId
        };
      },
      list: (ramp) => ramp.listCashbacks({ sync_status: "SYNC_READY" }),
      buildOutcome: buildSimpleCardOutcome({
        label: "Cashback",
        type: "Cashback"
      })
    }
  );
}
