import { XERO_CLIENT_ID, XERO_REDIRECT_URI } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import crypto from "crypto";

export const config = {
  runtime: "nodejs",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const xeroRedirectUri =
    XERO_REDIRECT_URI ||
    `${new URL(request.url).origin}/api/integrations/xero/oauth`;

  if (!XERO_CLIENT_ID) {
    return json({ error: "Xero OAuth not configured" }, { status: 500 });
  }

  // Xero OAuth 2.0 URL
  const baseUrl = "https://login.xero.com/identity/connect/authorize";

  // Generate state for CSRF protection
  const state = Buffer.from(
    JSON.stringify({
      companyId,
      userId,
      timestamp: Date.now(),
    })
  ).toString("base64");

  // Generate PKCE code verifier and challenge for additional security
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // Store code verifier in state for later use
  const stateWithPKCE = Buffer.from(
    JSON.stringify({
      companyId,
      userId,
      timestamp: Date.now(),
      codeVerifier,
    })
  ).toString("base64");

  // Xero required scopes for comprehensive accounting integration including customers and vendors
  const scopes = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "accounting.transactions",
    "accounting.transactions.read",
    "accounting.contacts",
    "accounting.contacts.read",
    "accounting.settings",
    "accounting.settings.read",
    "accounting.journals.read",
    "accounting.reports.read",
    "accounting.attachments",
    "accounting.attachments.read",
    "accounting.budgets.read",
    "accounting.invoices",
    "accounting.invoices.read",
    "accounting.bills",
    "accounting.bills.read",
    "accounting.accounts.read",
    "accounting.banktransactions",
    "accounting.banktransactions.read",
    "accounting.manualjournals",
    "accounting.manualjournals.read",
    "accounting.expenseclaims",
    "accounting.expenseclaims.read",
    "accounting.payments",
    "accounting.payments.read",
    "accounting.purchaseorders",
    "accounting.purchaseorders.read",
    "accounting.receipts",
    "accounting.receipts.read",
    "accounting.taxrates.read",
    "accounting.trackingcategories.read",
    "accounting.items",
    "accounting.items.read",
    // Additional scopes for customer and vendor management
    "accounting.suppliers",
    "accounting.suppliers.read",
  ].join(" ");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: XERO_CLIENT_ID,
    redirect_uri: xeroRedirectUri,
    scope: scopes,
    state: stateWithPKCE,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const url = `${baseUrl}?${params.toString()}`;

  return json({ url });
}
