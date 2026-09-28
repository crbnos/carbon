import {
  getAppUrl,
  QUICKBOOKS_CLIENT_ID,
  QUICKBOOKS_CLIENT_SECRET
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { consumeOAuthState } from "@carbon/auth/oauth-state.server";
import { QuickBooks } from "@carbon/ee";
import {
  DEFAULT_SYNC_CONFIG,
  getProviderIntegration,
  ProviderID
} from "@carbon/ee/accounting";
import { quickbooksOnInstall } from "@carbon/ee/quickbooks/hooks.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "quickbooks", "oauth");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const quickBooksAuthResponse = oAuthCallbackSchema.safeParse(searchParams);

  if (!quickBooksAuthResponse.success) {
    return data({ error: "Invalid QuickBooks auth response" }, { status: 400 });
  }

  const { data: params } = quickBooksAuthResponse;

  // The state must be the one the integrations page issued to THIS browser
  // for this user and company (IntegrationCard puts it on the authorize URL).
  // Without the check anyone could send a victim a callback URL carrying the
  // attacker's own authorization code, linking the victim's company to the
  // attacker's QuickBooks account. Single-use: consumed whether it matches or not.
  const consumedState = await consumeOAuthState(request, params.state, {
    integrationId: QuickBooks.id,
    userId,
    companyId
  });

  if (!consumedState.valid) {
    logger.error("Invalid QuickBooks OAuth state", { companyId, userId });
    return data(
      { error: "Invalid state parameter" },
      { status: 400, headers: { "Set-Cookie": consumedState.cookie } }
    );
  }

  if (!QUICKBOOKS_CLIENT_ID || !QUICKBOOKS_CLIENT_SECRET) {
    return data({ error: "QuickBooks OAuth not configured" }, { status: 500 });
  }

  // Intuit sends the company (realm) id alongside the auth code — no
  // discovery call needed (unlike Xero's GET /connections)
  const realmId = url.searchParams.get("realmId");

  if (!realmId) {
    return data(
      { error: "No realmId found in QuickBooks callback" },
      { status: 400 }
    );
  }

  try {
    const provider = getProviderIntegration(
      client,
      companyId,
      ProviderID.QUICKBOOKS
    );

    // Exchange the authorization code for tokens. The redirect_uri must match
    // the authorize-time one (IntegrationCard builds it from
    // `window.location.origin`); `new URL(request.url).origin` is the internal
    // proxy address behind a TLS-terminating proxy and fails as a mismatch.
    const auth = await provider.authenticate(
      params.code,
      `${getAppUrl()}/api/integrations/quickbooks/oauth`
    );

    if (!auth || auth.type !== "oauth2") {
      return data(
        { error: "Failed to exchange code for token" },
        { status: 500 }
      );
    }

    const createdQuickBooksIntegration = await upsertCompanyIntegration(
      client,
      {
        id: QuickBooks.id,
        active: true,
        // @ts-ignore
        metadata: {
          syncConfig: DEFAULT_SYNC_CONFIG,
          // Provider-specific fields live under providerMetadata (new
          // credential shape) — legacy rows are upgraded on read
          credentials: {
            ...auth,
            providerMetadata: {
              realmId
            }
          }
        },
        updatedBy: userId,
        companyId: companyId
      }
    );

    await quickbooksOnInstall(companyId);

    if (createdQuickBooksIntegration?.data?.metadata) {
      // Canonical public origin — `request.url`'s origin is the internal proxy
      // address in dev, which would drop the session cookies on redirect.
      return redirect(`${getAppUrl()}${path.to.integrations}`, {
        headers: { "Set-Cookie": consumedState.cookie }
      });
    } else {
      return data(
        { error: "Failed to save QuickBooks integration" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("QuickBooks OAuth Error:", err);
    return data(
      { error: "Failed to exchange code for token" },
      { status: 500 }
    );
  }
}
