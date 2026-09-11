import {
  patchRampCursor,
  type RampClient,
  type RampRepayment,
  scaleRepaymentLines
} from "@carbon/ee/ramp.server";
import { createAndPostTransaction } from "./ramp-sync-card";
import { recordRampFamilyError } from "./ramp-sync-observability";
import {
  isRampEntityInScope,
  isRampInboundFamilyEnabled
} from "./ramp-sync-policy";
import {
  type FamilyResult,
  getRampCurrencyDecimals,
  normalizeVerifiedMinorAmount,
  type RampSyncContext
} from "./ramp-sync-shared";

const REPAYMENT_REPAID_STATUS = "REPAID";
// Repayment.funding_method is a free string; only "ach" is demonstrated by
// Ramp's OpenAPI example (2026-09-11). Do not guess an offset for other values.
const REPAYMENT_BANK_FUNDING = "ach";

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

export async function syncRampRepayments(
  ctx: RampSyncContext,
  ramp: RampClient,
  entityId: string | undefined,
  cardLiabilityAccountId: string | undefined,
  integrationUpdatedAt: string | null | undefined
): Promise<FamilyResult> {
  const { client, companyId, metadata } = ctx;
  const integrationRow = { data: { updatedAt: integrationUpdatedAt } };
  const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
  // Repayments ride the same expense-recording gate as reimbursements.
  if (!isRampInboundFamilyEnabled("repayments", metadata.sync)) {
    return result;
  }
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
        if (!isRampEntityInScope(entityId, repayment.entity_id)) continue;
        if (repayment.status !== REPAYMENT_REPAID_STATUS) continue;
        const repaidAt = repayment.repaid_at ?? null;
        if (repayment.funding_method !== REPAYMENT_BANK_FUNDING) {
          failed += 1;
          if (repaidAt) failedRepaidAt.push(repaidAt);
          result.error ??= `Repayment ${repayment.id} has unsupported funding method: ${repayment.funding_method || "missing"}`;
          continue;
        }

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
        let decimals: number;
        try {
          decimals = await getRampCurrencyDecimals(ctx, currencyCode);
        } catch (error) {
          failed += 1;
          if (repaidAt) failedRepaidAt.push(repaidAt);
          console.error(
            `[RAMP SYNC] ${companyId}: repayment ${repayment.id} has invalid currency precision`,
            error
          );
          continue;
        }
        const normalizedAmount = await normalizeVerifiedMinorAmount(
          ctx,
          repayment.repayment_amount ?? repayment.amount,
          currencyCode,
          "Repayment amount"
        );
        if (!normalizedAmount.ok) {
          failed += 1;
          if (repaidAt) failedRepaidAt.push(repaidAt);
          console.error(
            `[RAMP SYNC] ${companyId}: repayment ${repayment.id} amount is invalid: ${normalizedAmount.error}`
          );
          continue;
        }
        const repaymentAmount = Math.abs(normalizedAmount.value);

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

        const offsetAccountId = metadata.statementBankAccountId;

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
          supplierId: null,
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
    recordRampFamilyError(result, familyError);
  }

  // Advance the cursor to min(max(processed), min(failed) - 1s) so failed
  // items are re-listed next sweep (there is no Ramp confirm for repayments).
  const nextCursor = computeRepaymentCursor(processedRepaidAt, failedRepaidAt);
  if (nextCursor) {
    await patchRampCursor(client, companyId, "repaymentsRepaidAt", nextCursor);
  }

  result.created = created;
  result.reconfirmed = reconfirmed;
  result.failed += failed;
  return result;
}
