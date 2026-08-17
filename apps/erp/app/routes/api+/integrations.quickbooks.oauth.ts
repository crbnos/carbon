import {
  QUICKBOOKS_CLIENT_ID,
  QUICKBOOKS_CLIENT_SECRET,
  VERCEL_URL
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { QuickBooks } from "@carbon/ee";
import {
  DEFAULT_SYNC_CONFIG,
  getProviderIntegration,
  ProviderID
} from "@carbon/ee/accounting";
import { quickbooksOnInstall } from "@carbon/ee/quickbooks/hooks.server";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

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

  // TODO: Verify state parameter
  if (!params.state) {
    return data({ error: "Invalid state parameter" }, { status: 400 });
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

    // Exchange the authorization code for tokens
    const auth = await provider.authenticate(
      params.code,
      `${url.origin}/api/integrations/quickbooks/oauth`
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
      const requestUrl = new URL(request.url);

      if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
        requestUrl.protocol = "http";
      }

      const redirectUrl = `${requestUrl.origin}${path.to.integrations}`;

      return redirect(redirectUrl);
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
