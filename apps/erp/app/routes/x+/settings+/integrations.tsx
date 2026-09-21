import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { issueOAuthState } from "@carbon/auth/oauth-state.server";
import { flash } from "@carbon/auth/session.server";
import {
  integrations as availableIntegrations,
  quickInstallConnectors
} from "@carbon/ee";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  data,
  Outlet,
  redirect,
  useLoaderData,
  useSearchParams
} from "react-router";
import { IntegrationsList } from "~/modules/settings";
import { getIntegrationError } from "~/modules/settings/integration-errors";
import { getIntegrationsWithHealth } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "settings"
  });

  const integrations = await getIntegrationsWithHealth(client, companyId);
  if (integrations.error) {
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(integrations.error, "Failed to load integrations")
      )
    );
  }

  const items = integrations.data.map((i) => ({
    id: i.id!,
    active: i.active!,
    health: i.health
  }));

  const rampOAuthState = await issueOAuthState({
    integrationId: "ramp",
    userId,
    companyId
  });

  return data(
    {
      integrations: items,
      // Existing OAuth callbacks still receive a server-generated correlation
      // value. Ramp uses the browser-bound, single-use value below.
      state: crypto.randomUUID(),
      oauthStates: { ramp: rampOAuthState.state }
    },
    { headers: { "Set-Cookie": rampOAuthState.cookie } }
  );
}

export default function IntegrationsRoute() {
  const { integrations } = useLoaderData<typeof loader>();
  const { i18n } = useLingui();
  const [searchParams, setSearchParams] = useSearchParams();

  const integration = searchParams.get("integration");
  const integrationError = searchParams.get("error");

  // An integration's OAuth callback can only redirect the browser, so it reports a
  // failed connect as `?integration=<id>&error=<code>` and the copy is resolved
  // here (see ~/modules/settings/integration-errors).
  useEffect(() => {
    if (!integration) return;

    const failure = getIntegrationError(integration, integrationError);
    if (failure) {
      toast.error(i18n._(failure.title), {
        // Same id for the same failure, so a re-render can't stack duplicates.
        id: `${integration}:${integrationError}`,
        description: i18n._(failure.description)
      });
    }

    // Consume the params either way — a reload shouldn't replay the toast, and an
    // unrecognized code shouldn't linger in the URL.
    setSearchParams(
      (params) => {
        params.delete("integration");
        params.delete("error");
        return params;
      },
      { replace: true, preventScrollReset: true }
    );
  }, [integration, integrationError, i18n, setSearchParams]);

  return (
    <>
      <IntegrationsList
        integrations={integrations}
        // @ts-expect-error TS2322 - TODO: fix type
        availableIntegrations={availableIntegrations}
        quickInstallConnectors={quickInstallConnectors}
      />
      <Outlet />
    </>
  );
}
