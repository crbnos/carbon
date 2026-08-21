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
  type RampCashback,
  type RampCurrencyAmount,
  type RampIntegrationMetadata,
  type RampTransaction,
  type RampTransfer
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

type SyncItem = { id: string; referenceId: string; deepLinkUrl?: string };
type FailItem = { id: string; message: string };
type FamilyResult = { created: number; reconfirmed: number; failed: number };

/**
 * Shared per-run context: the service-role client, the mapping service, and the
 * lazily-cached company scope (currency decimals + document groups).
 */
type Ctx = {
  client: CarbonClient;
  mapping: ReturnType<typeof createMappingService>;
  companyId: string;
  metadata: RampIntegrationMetadata;
  baseCurrency: string;
  companyGroupId: string | null;
  decimalsCache: Map<string, number>;
};

function deepLinkUrl(): string {
  return `${getAppUrl()}${CARD_TRANSACTIONS_PATH}`;
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

  const codeFromSelections = (
    selections: RampTransaction["accounting_field_selections"]
  ): { accountId: string | null; costCenterId: string | null } => {
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
  };

  if (tx.line_items && tx.line_items.length > 0) {
    for (const item of tx.line_items) {
      const { accountId, costCenterId } = codeFromSelections(
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
    const { accountId, costCenterId } = codeFromSelections(
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

    const ctx: Ctx = {
      client,
      mapping: createMappingService(getJobDatabaseClient(5), companyId),
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

    // Tasks 8–10 add bills / reimbursements / repayments / outbound step.run
    // blocks here.

    const totalFailed =
      cardResult.failed + transferResult.failed + cashbackResult.failed;

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
      cashbacks: cashbackResult
    };
  }
);
