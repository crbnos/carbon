import { VERCEL_URL, XERO_CLIENT_ID, XERO_CLIENT_SECRET } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getIntegrationConfigById, Xero } from "@carbon/ee";
import {
  DEFAULT_SYNC_CONFIG,
  getProviderIntegration,
  ProviderID
} from "@carbon/ee/accounting";
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

  const xeroAuthResponse = oAuthCallbackSchema.safeParse(searchParams);

  if (!xeroAuthResponse.success) {
    return data({ error: "Invalid Xero auth response" }, { status: 400 });
  }

  const { data: params } = xeroAuthResponse;

  // TODO: Verify state parameter
  if (!params.state) {
    return data({ error: "Invalid state parameter" }, { status: 400 });
  }

  if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET) {
    return data({ error: "Xero OAuth not configured" }, { status: 500 });
  }

  try {
    const provider = getProviderIntegration(client, companyId, ProviderID.XERO);

    // Exchange the authorization code for tokens
    const auth = await provider.authenticate(
      params.code,
      `${url.origin}/api/integrations/xero/oauth`
    );

    if (!auth) {
      return data(
        { error: "Failed to exchange code for token" },
        { status: 500 }
      );
    }

    // Fetch tenant ID from Xero connections endpoint
    const connectionsResponse = await fetch(
      "https://api.xero.com/connections",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!connectionsResponse.ok) {
      return data(
        { error: "Failed to fetch Xero connections" },
        { status: 500 }
      );
    }

    const connections = await connectionsResponse.json();

    if (!Array.isArray(connections) || connections.length === 0) {
      return data({ error: "No Xero connections found" }, { status: 500 });
    }

    // Get the first connection's tenant ID and name
    const tenantId = connections[0].tenantId;
    const tenantName = connections[0].tenantName;

    if (!tenantId) {
      return data(
        { error: "No tenant ID found in Xero connections" },
        { status: 500 }
      );
    }

    const createdXeroIntegration = await upsertCompanyIntegration(client, {
      id: Xero.id,
      active: true,
      // @ts-ignore
      metadata: {
        syncConfig: DEFAULT_SYNC_CONFIG,
        credentials: {
          ...auth,
          tenantId,
          tenantName: tenantName ?? undefined
        }
      },
      updatedBy: userId,
      companyId: companyId
    });

    const config = getIntegrationConfigById(Xero.id);

    typeof config?.onInstall === "function" &&
      (await config.onInstall(companyId));

    if (createdXeroIntegration?.data?.metadata) {
      const requestUrl = new URL(request.url);

      if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
        requestUrl.protocol = "http";
      }

      const redirectUrl = `${requestUrl.origin}${path.to.integrations}`;

      return redirect(redirectUrl);
    } else {
      return data(
        { error: "Failed to save Xero integration" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Xero OAuth Error:", err);
    return data(
      { error: "Failed to exchange code for token" },
      { status: 500 }
    );
  }
}
