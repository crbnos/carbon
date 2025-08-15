import {
  XERO_CLIENT_ID,
  XERO_CLIENT_SECRET,
  XERO_REDIRECT_URI,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";

import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

const xeroOAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string(),
  scope: z.string().optional(),
});

const xeroTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
  refresh_token: z.string(),
  id_token: z.string().optional(),
});

const xeroTenantSchema = z.object({
  tenantId: z.string(),
  tenantType: z.string(),
  tenantName: z.string().optional(),
  createdDateUtc: z.string().optional(),
  updatedDateUtc: z.string().optional(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const xeroAuthResponse = xeroOAuthCallbackSchema.safeParse(searchParams);

  if (!xeroAuthResponse.success) {
    return json({ error: "Invalid Xero auth response" }, { status: 400 });
  }

  const { data } = xeroAuthResponse;

  // Verify state for CSRF protection and get PKCE code verifier
  let parsedState;
  try {
    parsedState = JSON.parse(Buffer.from(data.state, "base64").toString());
  } catch {
    return json({ error: "Invalid state parameter" }, { status: 400 });
  }

  const stateSchema = z.object({
    companyId: z.string(),
    userId: z.string(),
    timestamp: z.number(),
    codeVerifier: z.string(),
  });

  const validatedState = stateSchema.safeParse(parsedState);

  if (!validatedState.success) {
    return json({ error: "Invalid state metadata" }, { status: 400 });
  }

  if (validatedState.data.companyId !== companyId) {
    return json({ error: "Invalid company" }, { status: 400 });
  }

  if (validatedState.data.userId !== userId) {
    return json({ error: "Invalid user" }, { status: 400 });
  }

  // Check if state is not too old (15 minutes)
  const stateAge = Date.now() - validatedState.data.timestamp;
  if (stateAge > 15 * 60 * 1000) {
    return json({ error: "State expired" }, { status: 400 });
  }

  // Validate required environment variables
  const xeroRedirectUri =
    XERO_REDIRECT_URI ||
    `${new URL(request.url).origin}/api/integrations/xero/oauth`;

  if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET) {
    return json({ error: "Xero OAuth not configured" }, { status: 500 });
  }

  try {
    // Exchange authorization code for tokens
    const tokenUrl = "https://identity.xero.com/connect/token";

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: XERO_CLIENT_ID,
      code: data.code,
      redirect_uri: xeroRedirectUri,
      code_verifier: validatedState.data.codeVerifier,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Xero token exchange failed:", errorText);
      return json(
        { error: "Failed to exchange code for token" },
        { status: 500 }
      );
    }

    const responseData = await response.json();
    const parsedTokenResponse = xeroTokenResponseSchema.safeParse(responseData);

    if (!parsedTokenResponse.success) {
      console.error("Invalid token response:", parsedTokenResponse.error);
      return json(
        { error: "Failed to parse Xero OAuth response" },
        { status: 500 }
      );
    }

    const { data: tokenData } = parsedTokenResponse;

    // Get authorized tenants (organizations) from Xero
    const tenantsUrl = "https://api.xero.com/connections";

    const tenantsResponse = await fetch(tenantsUrl, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
    });

    let tenants = [];
    let selectedTenant = null;

    if (tenantsResponse.ok) {
      const tenantsData = await tenantsResponse.json();
      if (Array.isArray(tenantsData)) {
        tenants = tenantsData;
        // Select the first tenant by default
        if (tenants.length > 0) {
          const parsedTenant = xeroTenantSchema.safeParse(tenants[0]);
          if (parsedTenant.success) {
            selectedTenant = parsedTenant.data;
          }
        }
      }
    }

    if (!selectedTenant) {
      return json({ error: "No Xero organization found" }, { status: 400 });
    }

    // Store the integration with tokens in metadata
    const createdXeroIntegration = await upsertCompanyIntegration(client, {
      id: Xero.id,
      active: true,
      metadata: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type,
        expires_at: Date.now() + tokenData.expires_in * 1000,
        tenant_id: selectedTenant.tenantId,
        tenant_name: selectedTenant.tenantName || "Xero Organization",
        tenant_type: selectedTenant.tenantType,
        all_tenants: tenants, // Store all available tenants for future reference
      },
      updatedBy: userId,
      companyId: companyId,
    });

    if (createdXeroIntegration?.data?.metadata) {
      // Send success message to opener window
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Xero OAuth Complete</title>
          </head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage('app_oauth_completed', '*');
                window.close();
              } else {
                window.location.href = '${path.to.integrations}';
              }
            </script>
            <p>Authorization complete. This window should close automatically.</p>
          </body>
        </html>
      `;

      return new Response(html, {
        headers: {
          "Content-Type": "text/html",
        },
      });
    } else {
      return json(
        { error: "Failed to save Xero integration" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Xero OAuth error:", err);
    return json({ error: "Failed to complete OAuth flow" }, { status: 500 });
  }
}
