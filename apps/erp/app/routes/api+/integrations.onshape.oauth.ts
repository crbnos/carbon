import {
  getCarbonServiceRole,
  ONSHAPE_CLIENT_ID,
  ONSHAPE_CLIENT_SECRET,
  ONSHAPE_OAUTH_REDIRECT_URL,
  VERCEL_URL
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { Onshape } from "@carbon/ee";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const authResponse = oAuthCallbackSchema.safeParse(searchParams);

  if (!authResponse.success) {
    return data({ error: "Invalid Onshape auth response" }, { status: 400 });
  }

  const { data: params } = authResponse;

  if (!params.state) {
    return data({ error: "Invalid state parameter" }, { status: 400 });
  }

  if (
    !ONSHAPE_CLIENT_ID ||
    !ONSHAPE_CLIENT_SECRET ||
    !ONSHAPE_OAUTH_REDIRECT_URL
  ) {
    return data({ error: "Onshape OAuth not configured" }, { status: 500 });
  }

  try {
    const tokenResponse = await fetch("https://oauth.onshape.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        client_id: ONSHAPE_CLIENT_ID,
        client_secret: ONSHAPE_CLIENT_SECRET,
        redirect_uri: ONSHAPE_OAUTH_REDIRECT_URL
      })
    });

    if (!tokenResponse.ok) {
      console.error(
        "Onshape token exchange failed:",
        tokenResponse.status,
        await tokenResponse.text()
      );
      return data(
        { error: "Failed to exchange code for token" },
        { status: 500 }
      );
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      return data(
        { error: "No access token in Onshape response" },
        { status: 500 }
      );
    }

    const serviceRole = getCarbonServiceRole();
    const createdIntegration = await upsertCompanyIntegration(serviceRole, {
      id: Onshape.id,
      active: true,
      metadata: {
        credentials: {
          type: "oauth2",
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
        },
        baseUrl: "https://cad.onshape.com"
      },
      updatedBy: userId,
      companyId: companyId
    });

    if (createdIntegration?.data?.metadata) {
      const requestUrl = new URL(request.url);

      if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
        requestUrl.protocol = "http";
      }

      const redirectUrl = `${requestUrl.origin}${path.to.integrations}`;

      return redirect(redirectUrl);
    } else {
      console.error({ createdIntegration });
      return data(
        { error: "Failed to save Onshape integration" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Onshape OAuth Error:", err);
    return data(
      { error: "Failed to exchange code for token" },
      { status: 500 }
    );
  }
}
