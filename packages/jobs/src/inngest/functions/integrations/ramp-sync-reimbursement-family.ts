import {
  confirmSyncs,
  type RampClient,
  type RampReimbursement
} from "@carbon/ee/ramp.server";
import { postPurchaseInvoice } from "./ramp-sync-bill";
import { recordRampFamilyError } from "./ramp-sync-observability";
import {
  isRampEntityInScope,
  isRampInboundFamilyEnabled
} from "./ramp-sync-policy";
import { syncRampReimbursement } from "./ramp-sync-reimbursement";
import {
  type FailItem,
  type FamilyResult,
  getRampCurrencyDecimals,
  getRampExchangeRate,
  invoiceDeepLinkUrl,
  normalizeVerifiedMinorAmount,
  type RampSyncContext,
  type SyncItem
} from "./ramp-sync-shared";

export async function syncRampReimbursements(
  ctx: RampSyncContext,
  ramp: RampClient,
  entityId: string | undefined
): Promise<FamilyResult> {
  const { client, companyId, metadata } = ctx;
  const result: FamilyResult = { created: 0, reconfirmed: 0, failed: 0 };
  if (!isRampInboundFamilyEnabled("reimbursements", metadata.sync)) {
    return result;
  }

  const successful: SyncItem[] = [];
  const failed: FailItem[] = [];

  try {
    for await (const page of ramp.listReimbursements({
      sync_status: "SYNC_READY"
    })) {
      for (const reimbursement of page as RampReimbursement[]) {
        if (!isRampEntityInScope(entityId, reimbursement.entity_id)) {
          continue;
        }
        const outcome = await syncRampReimbursement(
          {
            companyId: ctx.companyId,
            actorId: "system",
            baseCurrency: ctx.baseCurrency,
            companyGroupId: ctx.companyGroupId,
            reimbursementBankAccountId: metadata.reimbursementBankAccountId,
            statementBankAccountId: metadata.statementBankAccountId,
            db: ctx.db,
            client: ctx.client,
            getDecimals: (currencyCode) =>
              getRampCurrencyDecimals(ctx, currencyCode),
            getExchangeRate: (currencyCode) =>
              getRampExchangeRate(ctx, currencyCode),
            normalizeAmount: (value, currencyCode, label) =>
              normalizeVerifiedMinorAmount(ctx, value, currencyCode, label),
            postInvoice: (invoiceRowId) =>
              postPurchaseInvoice(ctx, invoiceRowId),
            invoiceDeepLinkUrl
          },
          reimbursement
        );
        if ("ok" in outcome) successful.push(outcome.ok);
        else failed.push(outcome.fail);
      }
    }
  } catch (familyError) {
    console.error(
      `[RAMP SYNC] ${companyId}: reimbursements drain failed`,
      familyError
    );
    recordRampFamilyError(result, familyError);
  }

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
    result.confirmError =
      confirmError instanceof Error
        ? confirmError.message
        : String(confirmError);
  }

  result.created = successful.length;
  result.failed += failed.length;
  return result;
}
