import { QUICKBOOKS_CLIENT_ID, QUICKBOOKS_REDIRECT_URI } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type LoaderFunctionArgs } from "@vercel/remix";

export const config = {
  runtime: "nodejs",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const quickbooksRedirectUri =
    QUICKBOOKS_REDIRECT_URI ||
    `${new URL(request.url).origin}/api/integrations/quickbooks/oauth`;

  if (!QUICKBOOKS_CLIENT_ID) {
    return json({ error: "QuickBooks OAuth not configured" }, { status: 500 });
  }

  // QuickBooks OAuth 2.0 URL
  const baseUrl = "https://appcenter.intuit.com/connect/oauth2";

  // Generate state for CSRF protection
  const state = Buffer.from(
    JSON.stringify({
      companyId,
      userId,
      timestamp: Date.now(),
    })
  ).toString("base64");

  // QuickBooks required scopes for accounting integration
  const scopes = [
    "com.intuit.quickbooks.accounting",
    "com.intuit.quickbooks.payment",
  ].join(" ");

  const params = new URLSearchParams({
    client_id: QUICKBOOKS_CLIENT_ID,
    scope: scopes,
    redirect_uri: quickbooksRedirectUri,
    response_type: "code",
    state,
  });

  const url = `${baseUrl}?${params.toString()}`;

  return json({ url });
}
