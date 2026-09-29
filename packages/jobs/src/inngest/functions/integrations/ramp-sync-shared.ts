import type { Database } from "@carbon/database";
import {
  clearResolvedSyncOperations,
  type createMappingService,
  insertTerminalSyncOperation,
  type SyncOperationDirection,
  type SyncOperationTrigger
} from "@carbon/ee/accounting";
import {
  buildRampIdempotencyKey,
  parseVerifiedRampMinorAmount,
  type RampIntegrationMetadata,
  rampMinorAmountToMajor,
  validateRampCurrencyDecimals,
  validateRampExchangeRate
} from "@carbon/ee/ramp.server";
import { getAppUrl } from "@carbon/env";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { getJobDatabaseClient } from "../../../db";

type CarbonClient = SupabaseClient<Database>;

const CHARGES_PATH = "/x/invoicing/charges";
const PURCHASE_INVOICE_PATH = "/x/purchase-invoice";
// `path.to.reimbursement(id)` in the ERP. Jobs cannot import app code, so the
// two are kept in step by hand — the document is a full page of its own, NOT a
// child of the invoicing list.
const REIMBURSEMENT_PATH = "/x/reimbursements";

export type SyncItem = {
  id: string;
  referenceId: string;
  deepLinkUrl?: string;
};
export type FailItem = { id: string; message: string };
export type FamilyResult = {
  created: number;
  reconfirmed: number;
  failed: number;
  error?: string;
  confirmError?: string;
};

export type RampSyncContext = {
  client: CarbonClient;
  db: ReturnType<typeof getJobDatabaseClient>;
  mapping: ReturnType<typeof createMappingService>;
  companyId: string;
  metadata: RampIntegrationMetadata;
  baseCurrency: string;
  companyGroupId: string | null;
  decimalsCache: Map<string, number>;
  exchangeRateCache: Map<string, number>;
  /** User the recorded sync operations are attributed to (integration configurer, else "system"). */
  createdBy: string;
  /** How this sync run was triggered — stamped on recorded sync operations. */
  trigger: SyncOperationTrigger;
};

const RAMP_INTEGRATION_ID = "ramp";

/**
 * Record each failed/skipped sync item as a terminal `Warning` operation on the
 * shared `accountingSyncOperation` ledger, so the integration's Sync Activity
 * tab shows WHY a Ramp record did not come through instead of it vanishing into
 * the Inngest logs. Idempotent per (entityType, entityId, direction): a
 * persistently-failing record does not stack rows. Failures to record are
 * logged, never thrown — observability must not fail the sync.
 */
export async function recordRampSyncFailures(
  ctx: RampSyncContext,
  args: {
    entityType: string;
    direction: SyncOperationDirection;
    failures: FailItem[];
  }
): Promise<void> {
  for (const failure of args.failures) {
    // Observability is strictly best-effort: a record that throws (or returns
    // an error) must never fail or pollute the family sync result.
    try {
      const { error } = await insertTerminalSyncOperation(ctx.client, {
        companyId: ctx.companyId,
        integration: RAMP_INTEGRATION_ID,
        entityType: args.entityType,
        entityId: failure.id,
        direction: args.direction,
        trigger: ctx.trigger,
        status: "Warning",
        errorCode: "RAMP_SYNC_FAILED",
        errorMessage: failure.message,
        idempotencyKey: buildRampIdempotencyKey({
          companyId: ctx.companyId,
          operation: `sync-fail:${args.entityType}:${args.direction}`,
          scope: failure.id
        }),
        createdBy: ctx.createdBy
      });
      if (error) {
        console.error(
          `[RAMP SYNC] ${ctx.companyId}: failed to record ${args.entityType} sync failure for ${failure.id}`,
          error
        );
      }
    } catch (recordError) {
      console.error(
        `[RAMP SYNC] ${ctx.companyId}: recording ${args.entityType} sync failure for ${failure.id} threw`,
        recordError
      );
    }
  }
}

/**
 * Clear any prior failed operation for records that synced successfully this
 * run — a Ramp charge recoded and posted after an earlier failure must drop out
 * of the Sync Activity inbox (Ramp's inbound families re-evaluate every run,
 * unlike accounting journals whose disposition is permanent). Logged, never
 * thrown.
 *
 * An INBOUND run also clears `Pending`, because Sync Activity's Retry button
 * moves a failed row back to `Pending` and nothing else ever queues inbound
 * work: the pull families re-read every ready record and record terminal rows
 * themselves. Clearing only `Warning` left a retried record that then synced
 * sitting in the inbox as "Pending" forever. OUTBOUND keeps the
 * `Warning`-only rule — there a `Pending` row is real queued work the push
 * drain owns, and it may have been enqueued by a change made after this push.
 */
export async function resolveRampSyncOperations(
  ctx: RampSyncContext,
  args: {
    entityType: string;
    direction: SyncOperationDirection;
    entityIds: string[];
  }
): Promise<void> {
  // Best-effort: clearing a resolved Warning must never fail the sync.
  try {
    const { error } = await clearResolvedSyncOperations(ctx.client, {
      companyId: ctx.companyId,
      integration: RAMP_INTEGRATION_ID,
      entityType: args.entityType,
      direction: args.direction,
      entityIds: args.entityIds,
      statuses:
        args.direction === "pull-from-accounting"
          ? ["Warning", "Pending"]
          : ["Warning"]
    });
    if (error) {
      console.error(
        `[RAMP SYNC] ${ctx.companyId}: failed to clear resolved ${args.entityType} sync operations`,
        error
      );
    }
  } catch (resolveError) {
    console.error(
      `[RAMP SYNC] ${ctx.companyId}: clearing resolved ${args.entityType} sync operations threw`,
      resolveError
    );
  }
}

export async function verifyCostCenters(
  ctx: RampSyncContext,
  lines: ReadonlyArray<{ costCenterId: string | null }>
): Promise<string | null> {
  const ids = [
    ...new Set(
      lines
        .map((line) => line.costCenterId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  if (ids.length === 0) return null;
  const { data, error } = await ctx.client
    .from("costCenter")
    .select("id")
    .in("id", ids)
    .eq("companyId", ctx.companyId);
  if (error) return `Failed to verify cost centers: ${error.message}`;
  const known = new Set((data ?? []).map((row) => row.id));
  if (ids.some((id) => !known.has(id))) {
    return "Line is coded to a cost center Carbon doesn't recognize — recode it in Ramp";
  }
  return null;
}

export async function verifyProjects(
  ctx: RampSyncContext,
  lines: ReadonlyArray<{ projectId: string | null }>
): Promise<string | null> {
  const ids = [
    ...new Set(
      lines
        .map((line) => line.projectId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  if (ids.length === 0) return null;
  const { data, error } = await ctx.client
    .from("project")
    .select("id")
    .in("id", ids)
    .eq("companyId", ctx.companyId);
  if (error) return `Failed to verify projects: ${error.message}`;
  const known = new Set((data ?? []).map((row) => row.id));
  if (ids.some((id) => !known.has(id))) {
    return "Line is coded to a project Carbon doesn't recognize — recode it in Ramp";
  }
  return null;
}

export function chargesDeepLinkUrl(): string {
  return `${getAppUrl()}${CHARGES_PATH}`;
}

export function invoiceDeepLinkUrl(invoiceRowId: string): string {
  return `${getAppUrl()}${PURCHASE_INVOICE_PATH}/${invoiceRowId}`;
}

export function reimbursementDeepLinkUrl(reimbursementRowId: string): string {
  return `${getAppUrl()}${REIMBURSEMENT_PATH}/${reimbursementRowId}`;
}

export async function getRampCurrencyDecimals(
  ctx: RampSyncContext,
  currencyCode: string
): Promise<number> {
  const cached = ctx.decimalsCache.get(currencyCode);
  if (cached !== undefined) return cached;
  if (!ctx.companyGroupId) {
    throw new Error(
      `Cannot resolve currency precision for ${currencyCode}: company group is missing`
    );
  }
  const { data, error } = await ctx.client
    .from("currency")
    .select("decimalPlaces")
    .eq("companyGroupId", ctx.companyGroupId)
    .eq("code", currencyCode)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to resolve currency precision for ${currencyCode}: ${error.message}`
    );
  }
  const validated = validateRampCurrencyDecimals(
    data?.decimalPlaces,
    currencyCode
  );
  if (!validated.ok) throw new Error(validated.error);
  ctx.decimalsCache.set(currencyCode, validated.value);
  return validated.value;
}

export async function getRampExchangeRate(
  ctx: RampSyncContext,
  currencyCode: string
): Promise<number> {
  if (currencyCode === ctx.baseCurrency) return 1;
  const cached = ctx.exchangeRateCache.get(currencyCode);
  if (cached !== undefined) return cached;
  const { data, error } = await ctx.client.rpc("get_exchange_rate", {
    p_company_id: ctx.companyId,
    p_currency_code: currencyCode
  });
  if (error) {
    throw new Error(
      `Failed to resolve exchange rate for ${currencyCode}: ${error.message}`
    );
  }
  const validated = validateRampExchangeRate(data, currencyCode);
  if (!validated.ok) throw new Error(validated.error);
  ctx.exchangeRateCache.set(currencyCode, validated.value);
  return validated.value;
}

export async function normalizeVerifiedMinorAmount(
  ctx: RampSyncContext,
  value: unknown,
  expectedCurrencyCode: string,
  label: string,
  options: { allowDifferentCurrency?: boolean } = {}
): Promise<{ ok: true; value: number } | { ok: false; error: string }> {
  const parsed = parseVerifiedRampMinorAmount(value, label);
  if (!parsed.ok) return parsed;
  const sourceCurrencyCode = parsed.value.currencyCode ?? expectedCurrencyCode;
  if (
    !options.allowDifferentCurrency &&
    sourceCurrencyCode !== expectedCurrencyCode
  ) {
    return {
      ok: false,
      error: `${label} currency ${sourceCurrencyCode} does not match ${expectedCurrencyCode}`
    };
  }
  try {
    const decimals = await getRampCurrencyDecimals(ctx, sourceCurrencyCode);
    return {
      ok: true,
      value: rampMinorAmountToMajor(parsed.value, sourceCurrencyCode, decimals)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

export function documentTypeForFile(
  fileName: string
): Database["public"]["Enums"]["documentType"] {
  const ext = extension(fileName);
  if (ext === "pdf") return "PDF";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) {
    return "Image";
  }
  return "Other";
}

// Mirror of ~/utils/string stripSpecialCharacters (app-only, not importable).
export function stripSpecialCharacters(input: string): string {
  return input.replace(/[^a-zA-Z0-9/!_\-.*'() &$@=;:+,?]/g, "");
}
