import { QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import {
  getCompanyIntegration,
  upsertCompanyIntegration,
} from "~/modules/settings/settings.server";

export const config = {
  runtime: "nodejs",
};

const quickBooksMetadataSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  realm_id: z.string(),
  company_name: z.string(),
  token_type: z.string(),
  expires_at: z.number(),
  refresh_expires_at: z.number(),
});

const quickBooksTokenResponseSchema = z.object({
  token_type: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  x_refresh_token_expires_in: z.number(),
});

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  // Get current integration
  const integration = await getCompanyIntegration(
    client,
    companyId,
    "quickbooks"
  );

  if (!integration?.metadata) {
    return json({ error: "QuickBooks integration not found" }, { status: 404 });
  }

  const parsedMetadata = quickBooksMetadataSchema.safeParse(
    integration.metadata
  );

  if (!parsedMetadata.success) {
    return json({ error: "Invalid integration metadata" }, { status: 400 });
  }

  const { data: metadata } = parsedMetadata;

  // Check if refresh token is still valid
  if (metadata.refresh_expires_at < Date.now()) {
    return json(
      { error: "Refresh token expired, please reconnect" },
      { status: 401 }
    );
  }

  // Validate required environment variables
  if (!QUICKBOOKS_CLIENT_ID || !QUICKBOOKS_CLIENT_SECRET) {
    return json({ error: "QuickBooks OAuth not configured" }, { status: 500 });
  }

  try {
    // Refresh the access token
    const tokenUrl =
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

    const authHeader = Buffer.from(
      `${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: metadata.refresh_token,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("QuickBooks token refresh failed:", errorText);
      return json({ error: "Failed to refresh token" }, { status: 500 });
    }

    const responseData = await response.json();
    const parsedTokenResponse =
      quickBooksTokenResponseSchema.safeParse(responseData);

    if (!parsedTokenResponse.success) {
      console.error("Invalid token response:", parsedTokenResponse.error);
      return json(
        { error: "Failed to parse QuickBooks refresh response" },
        { status: 500 }
      );
    }

    const { data: tokenData } = parsedTokenResponse;

    // Update the integration with new tokens
    const updatedIntegration = await upsertCompanyIntegration(client, {
      id: "quickbooks",
      active: true,
      metadata: {
        ...metadata,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type,
        expires_at: Date.now() + tokenData.expires_in * 1000,
        refresh_expires_at:
          Date.now() + tokenData.x_refresh_token_expires_in * 1000,
      },
      updatedBy: userId,
      companyId: companyId,
    });

    if (updatedIntegration?.data?.metadata) {
      return json({
        success: true,
        expires_at: Date.now() + tokenData.expires_in * 1000,
      });
    } else {
      return json(
        { error: "Failed to update QuickBooks integration" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("QuickBooks refresh error:", err);
    return json({ error: "Failed to refresh token" }, { status: 500 });
  }
}
