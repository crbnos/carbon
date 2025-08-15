import {
  QUICKBOOKS_CLIENT_ID,
  QUICKBOOKS_CLIENT_SECRET,
  QUICKBOOKS_REDIRECT_URI,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

const quickBooksOAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string(),
  realmId: z.string(), // QuickBooks company ID
});

const quickBooksTokenResponseSchema = z.object({
  token_type: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  x_refresh_token_expires_in: z.number(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const quickBooksAuthResponse =
    quickBooksOAuthCallbackSchema.safeParse(searchParams);

  if (!quickBooksAuthResponse.success) {
    return json({ error: "Invalid QuickBooks auth response" }, { status: 400 });
  }

  const { data } = quickBooksAuthResponse;

  // Verify state for CSRF protection
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
  const quickbooksRedirectUri =
    QUICKBOOKS_REDIRECT_URI ||
    `${new URL(request.url).origin}/api/integrations/quickbooks/oauth`;

  if (!QUICKBOOKS_CLIENT_ID || !QUICKBOOKS_CLIENT_SECRET) {
    return json({ error: "QuickBooks OAuth not configured" }, { status: 500 });
  }

  try {
    // Exchange authorization code for tokens
    const tokenUrl =
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

    const authHeader = Buffer.from(
      `${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: data.code,
      redirect_uri: quickbooksRedirectUri,
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
      console.error("QuickBooks token exchange failed:", errorText);
      return json(
        { error: "Failed to exchange code for token" },
        { status: 500 }
      );
    }

    const responseData = await response.json();
    const parsedTokenResponse =
      quickBooksTokenResponseSchema.safeParse(responseData);

    if (!parsedTokenResponse.success) {
      console.error("Invalid token response:", parsedTokenResponse.error);
      return json(
        { error: "Failed to parse QuickBooks OAuth response" },
        { status: 500 }
      );
    }

    const { data: tokenData } = parsedTokenResponse;

    // Get company info from QuickBooks
    const companyInfoUrl = `https://sandbox-quickbooks.api.intuit.com/v3/company/${data.realmId}/companyinfo/${data.realmId}`;

    const companyResponse = await fetch(companyInfoUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    let companyName = "QuickBooks Company";
    if (companyResponse.ok) {
      const companyData = await companyResponse.json();
      companyName = companyData.CompanyInfo?.CompanyName || companyName;
    }

    // Store the integration with tokens in metadata
    const createdQuickBooksIntegration = await upsertCompanyIntegration(
      client,
      {
        id: "quickbooks",
        active: true,
        metadata: {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          realm_id: data.realmId,
          company_name: companyName,
          token_type: tokenData.token_type,
          expires_at: Date.now() + tokenData.expires_in * 1000,
          refresh_expires_at:
            Date.now() + tokenData.x_refresh_token_expires_in * 1000,
        },
        updatedBy: userId,
        companyId: companyId,
      }
    );

    if (createdQuickBooksIntegration?.data?.metadata) {
      // Send success message to opener window
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>QuickBooks OAuth Complete</title>
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
        { error: "Failed to save QuickBooks integration" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("QuickBooks OAuth error:", err);
    return json({ error: "Failed to complete OAuth flow" }, { status: 500 });
  }
}
