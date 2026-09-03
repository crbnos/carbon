import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getIntegrationConfigById } from "@carbon/ee";
import {
  exchangeCodeForTokens,
  getAccessibleResources
} from "@carbon/ee/jira.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

const logger = getLogger("erp", "integrations-jira-oauth");

export const config = {
  runtime: "nodejs"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const jiraAuthResponse = oAuthCallbackSchema.safeParse(searchParams);

  if (!jiraAuthResponse.success) {
    return data({ error: "Invalid Jira auth response" }, { status: 400 });
  }

  const { data: params } = jiraAuthResponse;

  if (!params.state) {
    return data({ error: "Invalid state parameter" }, { status: 400 });
  }

  try {
    // Must match the authorize-time redirect_uri, which IntegrationCard builds
    // from `window.location.origin`. `new URL(request.url).origin` is the
    // internal proxy address behind a TLS-terminating proxy (e.g. the portless
    // dev proxy → http://127.0.0.1:<port>), which fails as a redirect_uri
    // mismatch. `getAppUrl()` is the canonical public origin in dev/preview/prod.
    const redirectUri = `${getAppUrl()}/api/integrations/jira/oauth`;

    // Exchange the authorization code for tokens
    const tokens = await exchangeCodeForTokens(params.code, redirectUri);

    if (!tokens) {
      return data(
        { error: "Failed to exchange code for token" },
        { status: 500 }
      );
    }

    // Get accessible resources to find cloudId
    const resources = await getAccessibleResources(tokens.accessToken);

    if (resources.length === 0) {
      return data(
        {
          error:
            "No Jira Cloud sites found. Make sure you have access to at least one Jira site."
        },
        { status: 400 }
      );
    }

    // Use the first available resource
    const resource = resources[0];

    const createdJiraIntegration = await upsertCompanyIntegration(client, {
      id: "jira",
      active: true,
      metadata: {
        credentials: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          cloudId: resource.id,
          siteUrl: resource.url
        }
      },
      updatedBy: userId,
      companyId: companyId
    });

    const config = getIntegrationConfigById("jira");

    typeof config?.onInstall === "function" &&
      (await config.onInstall(companyId));

    if (createdJiraIntegration?.data?.metadata) {
      // Redirect on the canonical public origin — `request.url`'s origin is the
      // internal proxy address in dev, which would drop the session cookies.
      return redirect(`${getAppUrl()}${path.to.integrations}`);
    } else {
      return data(
        { error: "Failed to save Jira integration" },
        { status: 500 }
      );
    }
  } catch (err) {
    logger.error("Jira OAuth Error", { error: err });
    return data(
      { error: "Failed to exchange code for token" },
      { status: 500 }
    );
  }
}
