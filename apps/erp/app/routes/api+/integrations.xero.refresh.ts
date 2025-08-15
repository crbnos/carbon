import { requirePermissions } from "@carbon/auth/auth.server";
import { XERO_CLIENT_ID, XERO_CLIENT_SECRET } from "@carbon/auth/config";
import { Xero } from "@carbon/integrations";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import { getCompanyIntegration, upsertCompanyIntegration } from "~/modules/settings/settings.server";

export const config = {
  runtime: "nodejs",
};

const xeroMetadataSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
  expires_at: z.number(),
  tenant_id: z.string(),
  tenant_name: z.string(),
  tenant_type: z.string(),
  all_tenants: z.array(z.any()).optional(),
});

const xeroTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
  refresh_token: z.string(),
  id_token: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  // Get current integration
  const integration = await getCompanyIntegration(client, companyId, Xero.id);
  
  if (!integration?.metadata) {
    return json({ error: "Xero integration not found" }, { status: 404 });
  }

  const parsedMetadata = xeroMetadataSchema.safeParse(integration.metadata);
  
  if (!parsedMetadata.success) {
    return json({ error: "Invalid integration metadata" }, { status: 400 });
  }

  const { data: metadata } = parsedMetadata;

  // Validate required environment variables
  if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET) {
    return json({ error: "Xero OAuth not configured" }, { status: 500 });
  }

  try {
    // Refresh the access token
    const tokenUrl = "https://identity.xero.com/connect/token";
    
    const authHeader = Buffer.from(
      `${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: metadata.refresh_token,
      client_id: XERO_CLIENT_ID,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Xero token refresh failed:", errorText);
      return json(
        { error: "Failed to refresh token" },
        { status: 500 }
      );
    }

    const responseData = await response.json();
    const parsedTokenResponse = xeroTokenResponseSchema.safeParse(responseData);

    if (!parsedTokenResponse.success) {
      console.error("Invalid token response:", parsedTokenResponse.error);
      return json(
        { error: "Failed to parse Xero refresh response" },
        { status: 500 }
      );
    }

    const { data: tokenData } = parsedTokenResponse;

    // Update the integration with new tokens
    const updatedIntegration = await upsertCompanyIntegration(client, {
      id: Xero.id,
      active: true,
      metadata: {
        ...metadata,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
      },
      updatedBy: userId,
      companyId: companyId,
    });

    if (updatedIntegration?.data?.metadata) {
      return json({ success: true, expires_at: Date.now() + (tokenData.expires_in * 1000) });
    } else {
      return json(
        { error: "Failed to update Xero integration" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Xero refresh error:", err);
    return json(
      { error: "Failed to refresh token" },
      { status: 500 }
    );
  }
}