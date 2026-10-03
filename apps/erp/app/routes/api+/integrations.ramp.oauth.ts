// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { consumeOAuthState } from "@carbon/auth/oauth-state.server";
import { Ramp } from "@carbon/ee";
import { rampOnInstall } from "@carbon/ee/ramp/hooks.server";
import {
  buildRampClient,
  exchangeRampOAuthCode,
  isRampSeatConflict,
  patchRampOAuthCredentials,
  resolveConnectedProviderName
} from "@carbon/ee/ramp.server";
import { getLogger } from "@carbon/logger";
import { redirectExternal } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import type { IntegrationErrorCode } from "~/modules/settings/integration-errors";
import { integrationErrorSearch } from "~/modules/settings/integration-errors";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

// nodejs runtime: the code exchange uses the OAuth app's client secret.
export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "ramp", "oauth");

function connectionFailed(
  reason: IntegrationErrorCode<"ramp">,
  stateCookie: string
) {
  return redirectExternal(
    `${getAppUrl()}${path.to.integrations}${integrationErrorSearch(
      "ramp",
      reason
    )}`,
    { headers: { "Set-Cookie": stateCookie } }
  );
}

function connectionSucceeded(stateCookie: string) {
  return redirectExternal(`${getAppUrl()}${path.to.integrations}`, {
    headers: { "Set-Cookie": stateCookie }
  });
}

/**
 * Which system Ramp reports as holding its accounting connection.
 *
 * Returns undefined for BOTH "there is no peer" and "Carbon could not tell" —
 * deliberately conflated here, because the caller must not record a guess either
 * way. The healthcheck is where the distinction is surfaced to a human, and it
 * re-reads live rather than trusting this snapshot.
 *
 * Never throws: the install has a valid grant by this point, and failing the
 * connect over an informational read would strand it.
 */
async function readAccountingConnectionProvider(
  companyId: string,
  credentials: Parameters<typeof buildRampClient>[2]
): Promise<string | undefined> {
  try {
    const client = buildRampClient(
      getCarbonServiceRole(),
      companyId,
      credentials
    );
    // `resolveConnectedProviderName` filters on STATUS, which is load-bearing:
    // `DELETE /accounting/connection` leaves an `unlinked` tombstone that still
    // carries the old provider's name (verified live 2026-09-25), so an unfiltered
    // read reports a ledger holder for a business that has none.
    return resolveConnectedProviderName(
      await client.getAccountingConnections()
    );
  } catch (error) {
    logger.warning(
      "Could not read Ramp accounting connections after connect; treating the owner as unknown",
      { companyId, error }
    );
    return undefined;
  }
}

/**
 * Ramp "Connect to Ramp" OAuth callback. Ramp redirects here with `code` +
 * `state` after the user approves. We exchange the code for oauth2 tokens using
 * Carbon's registered Ramp OAuth app, store them (the vault holds the access +
 * refresh tokens via the atomic integration-state patch), and run the install
 * converge (chart-of-accounts push, connection, webhook, initial sync). Account
 * mapping happens afterwards in the integration's Details drawer.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const state = url.searchParams.get("state") ?? "";
  const consumedState = await consumeOAuthState(request, state, {
    integrationId: Ramp.id,
    userId,
    companyId
  });

  if (!consumedState.valid) {
    logger.error("Invalid Ramp OAuth state", { companyId, userId });
    return connectionFailed("invalid-state", consumedState.cookie);
  }

  if (searchParams.error) {
    logger.error("Ramp authorization refused", {
      error: searchParams.error,
      errorDescription: searchParams.error_description
    });
    return connectionFailed("denied", consumedState.cookie);
  }

  const rampAuthResponse = oAuthCallbackSchema.safeParse(searchParams);
  if (!rampAuthResponse.success) {
    logger.error("Invalid Ramp auth response", {
      params: Object.keys(searchParams)
    });
    return connectionFailed("invalid-response", consumedState.cookie);
  }

  const { code } = rampAuthResponse.data;

  // The redirect_uri sent to Ramp's token endpoint MUST byte-for-byte match the
  // one used at authorize time. Both now come from `getAppUrl()` — the connect
  // route builds the authorize URL server-side — so they agree by construction.
  // (They used to agree only because the browser's `window.location.origin`
  // happened to equal the canonical origin.) NOT `new URL(request.url).origin`,
  // which behind the portless dev proxy and any TLS-terminating proxy is the
  // internal `http://127.0.0.1:<port>` and produces an `invalid_grant`
  // (DEVELOPER_7012) mismatch.
  const redirectUri = `${getAppUrl()}/api/integrations/ramp/oauth`;

  let exchanged: Awaited<ReturnType<typeof exchangeRampOAuthCode>>;
  try {
    exchanged = await exchangeRampOAuthCode(code, redirectUri);
  } catch (error) {
    logger.error("Ramp token exchange failed", { error, companyId });
    return connectionFailed("token-exchange", consumedState.cookie);
  }

  const { credentials, grantedScopes } = exchanged;

  // The mode comes off the SIGNED state, never a query parameter — a
  // user-editable value here would let someone consent to push-only's narrow
  // scopes and have Carbon record a provider-mode install, or the reverse.
  const syncMode = consumedState.payload?.mode;

  // Which system holds Ramp's accounting connection. Read best-effort and treated
  // as UNKNOWN on failure, not as absent: whether a token lacking
  // `accounting:write` may call this at all is an OPEN QUESTION (see
  // `.ai/plans/implemented/2026-09-23-spend-push-only-mode.md`). Recording "no peer" from a
  // 403 would make every push-only install report itself broken.
  const accountingConnectionProvider = await readAccountingConnectionProvider(
    companyId,
    credentials
  );

  try {
    await patchRampOAuthCredentials(getCarbonServiceRole(), companyId, {
      credentials,
      grantedScopes,
      syncMode,
      accountingConnectionProvider,
      updatedBy: userId
    });
  } catch (error) {
    // The one-active-per-role trigger raises 23505. Ramp's authorization
    // already succeeded at this point, so the honest report is "another spend
    // integration holds the slot", not a generic save failure.
    if (
      typeof (error as { code?: unknown })?.code === "string" &&
      (error as { code: string }).code === "23505"
    ) {
      logger.error("Ramp connect refused — a spend integration is active", {
        companyId
      });
      return connectionFailed("role-conflict", consumedState.cookie);
    }
    logger.error("Failed to save Ramp integration", { error, companyId });
    return connectionFailed("save-failed", consumedState.cookie);
  }

  try {
    await rampOnInstall(companyId);
  } catch (error) {
    // Ramp permits ONE connected accounting system. When another holds it, the
    // generic "try connecting again" is actively wrong — retrying cannot succeed.
    // Name the conflict so the customer can pick one of the two real remedies.
    if (isRampSeatConflict(error)) {
      logger.error("Ramp connect refused — its accounting seat is taken", {
        companyId
      });
      return connectionFailed("seat-conflict", consumedState.cookie);
    }
    logger.error("Ramp install convergence failed", { error, companyId });
    return connectionFailed("install-failed", consumedState.cookie);
  }

  return connectionSucceeded(consumedState.cookie);
}
