import { VERCEL_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { Ramp } from "@carbon/ee";
import { rampOnInstall } from "@carbon/ee/ramp/hooks.server";
import { exchangeRampOAuthCode } from "@carbon/ee/ramp.server";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

// nodejs runtime: the code exchange uses the OAuth app's client secret.
export const config = {
  runtime: "nodejs"
};

/**
 * Ramp "Connect to Ramp" OAuth callback. Ramp redirects here with `code` +
 * `state` after the user approves. We exchange the code for oauth2 tokens using
 * Carbon's registered Ramp OAuth app, store them (the vault holds the access +
 * refresh tokens via `upsertCompanyIntegration`), and run the standard install
 * converge (chart-of-accounts push, connection, webhook, initial sync). Account
 * mapping happens afterwards in the integration's Details drawer.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const rampAuthResponse = oAuthCallbackSchema.safeParse(searchParams);
  if (!rampAuthResponse.success) {
    // Ramp returns `error`/`error_description` on denial (e.g. access_denied).
    return data(
      { error: url.searchParams.get("error") ?? "Invalid Ramp auth response" },
      { status: 400 }
    );
  }

  const { code, state } = rampAuthResponse.data;

  // TODO: verify `state` against a server-issued value (parity with the other
  // OAuth callbacks, which currently only check presence). Presence is the
  // minimum CSRF guard until a signed/nonce state lands.
  if (!state) {
    return data({ error: "Invalid state parameter" }, { status: 400 });
  }

  try {
    const credentials = await exchangeRampOAuthCode(
      code,
      `${url.origin}/api/integrations/ramp/oauth`
    );

    const created = await upsertCompanyIntegration(client, {
      id: Ramp.id,
      active: true,
      // @ts-ignore — credentials shape is validated by RampIntegrationMetadataSchema on read
      metadata: { credentials },
      updatedBy: userId,
      companyId
    });

    if (!created?.data?.metadata) {
      return data(
        { error: "Failed to save Ramp integration" },
        { status: 500 }
      );
    }

    // Converge (validate via getBusiness, push chart of accounts + cost centers,
    // ensure the connection + webhook) and fire the initial sync.
    await rampOnInstall(companyId);

    const requestUrl = new URL(request.url);
    if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
      requestUrl.protocol = "http";
    }
    return redirect(`${requestUrl.origin}${path.to.integrations}`);
  } catch (err) {
    console.error("Ramp OAuth Error:", err);
    return data(
      { error: "Failed to exchange the Ramp authorization code" },
      { status: 500 }
    );
  }
}
