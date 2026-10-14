// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { parseDate } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountingProvider } from "../providers";
import { QboProvider } from "../providers/quickbooks-online";
import { RilletProvider } from "../providers/rillet";
import { XeroProvider } from "../providers/xero";
import { getAccountMappings, getCompanyGroupId } from "./account-mapping";
import type { ProviderID } from "./models";
import { getAccountingIntegration, getProviderIntegration } from "./service";
import {
  type MappedTrialBalance,
  mapRemoteTrialBalance,
  type RemoteTrialBalance,
  TrialBalancePullError
} from "./trial-balance";
import {
  AccountingApiError,
  AccountingAuthError,
  RatelimitError
} from "./utils";

/**
 * Provider-agnostic read of the trial balance as at `asOfDate` (YYYY-MM-DD),
 * debit-signed per remote account. Dispatches on the concrete provider class,
 * the same discrimination `fetchRemoteJournalTotals` uses.
 *
 * Rillet's `ending_balance` sign is not documented; `parseRilletTrialBalance`
 * reads it the way the report itself agrees with.
 *
 * Provider errors propagate (AccountingApiError, AccountingAuthError,
 * RatelimitError); `pullTrialBalanceFromProvider` turns them into a
 * TrialBalancePullError.
 */
export async function fetchRemoteTrialBalance(
  provider: AccountingProvider,
  asOfDate: string
): Promise<RemoteTrialBalance> {
  if (provider instanceof XeroProvider) {
    return { supported: true, rows: await provider.getTrialBalance(asOfDate) };
  }

  if (provider instanceof QboProvider) {
    return { supported: true, rows: await provider.getTrialBalance(asOfDate) };
  }

  if (provider instanceof RilletProvider) {
    return { supported: true, rows: await provider.getTrialBalance(asOfDate) };
  }

  return { supported: false };
}

const RECONNECT_MESSAGE =
  "The accounting integration did not allow Carbon to read the trial balance. Reconnect the integration to grant access to reports, then try again.";

function toPullError(error: unknown): TrialBalancePullError {
  if (error instanceof TrialBalancePullError) return error;

  if (error instanceof AccountingAuthError) {
    return new TrialBalancePullError("reconnect", RECONNECT_MESSAGE, {
      cause: error
    });
  }

  if (
    error instanceof AccountingApiError &&
    (error.details.statusCode === 401 || error.details.statusCode === 403)
  ) {
    return new TrialBalancePullError("reconnect", RECONNECT_MESSAGE, {
      cause: error
    });
  }

  if (error instanceof RatelimitError) {
    return new TrialBalancePullError(
      "rate_limited",
      `The accounting provider is limiting requests. Try again in ${error.retryAfterSeconds} seconds.`,
      { cause: error }
    );
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new TrialBalancePullError(
    "failed",
    `Could not read the trial balance from the accounting provider: ${detail}`,
    { cause: error }
  );
}

/**
 * Pull the connected provider's trial balance as at `asOfDate` (YYYY-MM-DD)
 * and put it onto the company's Carbon accounts (see `mapRemoteTrialBalance`).
 *
 * Throws TrialBalancePullError — check `reason` — when the provider is not
 * connected, has no trial balance reader, refused the token, throttled the
 * request, or failed. Server-only: it reads vaulted credentials.
 */
export async function pullTrialBalanceFromProvider(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; providerId: ProviderID; asOfDate: string }
): Promise<MappedTrialBalance> {
  const { companyId, providerId, asOfDate } = args;

  try {
    parseDate(asOfDate);
  } catch {
    throw new TrialBalancePullError(
      "failed",
      `"${asOfDate}" is not a date (YYYY-MM-DD)`
    );
  }

  const integration = await getAccountingIntegration(
    client,
    companyId,
    providerId
  ).catch((error: unknown) => {
    throw new TrialBalancePullError(
      "not_connected",
      "The accounting integration is not connected.",
      { cause: error }
    );
  });
  if (!integration.active) {
    throw new TrialBalancePullError(
      "not_connected",
      "The accounting integration is not connected."
    );
  }

  let remote: RemoteTrialBalance;
  try {
    const provider = getProviderIntegration(
      client,
      companyId,
      integration.id,
      integration.metadata
    );
    remote = await fetchRemoteTrialBalance(provider, asOfDate);
  } catch (error) {
    throw toPullError(error);
  }

  if (!remote.supported) {
    throw new TrialBalancePullError(
      "unsupported",
      "This accounting integration cannot provide a trial balance. Enter the balances by hand."
    );
  }

  const mappings = await getAccountMappings(db, {
    companyId,
    integration: providerId
  });
  if (mappings.error || !mappings.data) {
    throw new TrialBalancePullError(
      "failed",
      `Could not read the account mappings: ${mappings.error ?? "no data"}`
    );
  }

  const companyGroupId = await getCompanyGroupId(db, companyId);
  if (!companyGroupId) {
    throw new TrialBalancePullError(
      "failed",
      `No company group found for company ${companyId}`
    );
  }

  const accounts = await db
    .selectFrom("account")
    .select(["id", "number", "isGroup", "active"])
    .where("companyGroupId", "=", companyGroupId)
    .execute();

  return mapRemoteTrialBalance(
    remote.rows,
    mappings.data,
    accounts.map((account) => ({
      id: account.id,
      number: account.number ?? null,
      isGroup: Boolean(account.isGroup),
      active: Boolean(account.active)
    }))
  );
}
