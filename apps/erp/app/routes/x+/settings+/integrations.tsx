import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  integrations as availableIntegrations,
  quickInstallConnectors
} from "@carbon/ee";
import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useSearchParams } from "react-router";
import { IntegrationsList } from "~/modules/settings";
import { getIntegrationsWithHealth } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
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

  return {
    integrations: items,
    state: crypto.randomUUID()
  };
}

export default function IntegrationsRoute() {
  const { integrations } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const [searchParams] = useSearchParams();

  // The Onshape OAuth callback (api/integrations/onshape/oauth) can only redirect
  // the browser, so it reports a failed connect as `?onshapeError=<code>` and the
  // copy lives here. Codes are a closed set — an unrecognized one renders nothing
  // rather than a blank alert.
  const onshapeFailures: Record<string, { title: string; body: string }> = {
    "write-permission": {
      title: t`Onshape denied the connection`,
      body: t`In Onshape, edit this OAuth application's permissions to include "Application can write to your documents", then connect again.`
    },
    denied: {
      title: t`Onshape denied the connection`,
      body: t`The authorization was refused in Onshape. Try connecting again.`
    },
    "invalid-response": {
      title: t`Onshape didn't return an authorization code`,
      body: t`The response from Onshape was missing required parameters. Try connecting again.`
    },
    "not-configured": {
      title: t`Onshape isn't configured`,
      body: t`This Carbon instance is missing its Onshape OAuth credentials. Ask an administrator to set them.`
    },
    "token-exchange": {
      title: t`Onshape rejected the authorization`,
      body: t`Exchanging the authorization code for an access token failed. Try connecting again.`
    },
    "save-failed": {
      title: t`Couldn't save the Onshape connection`,
      body: t`Onshape authorized the connection but saving it failed. Try connecting again.`
    },
    unexpected: {
      title: t`Couldn't complete the Onshape connection`,
      body: t`An unexpected error occurred while connecting to Onshape. Try connecting again.`
    }
  };

  const onshapeError = searchParams.get("onshapeError");
  const onshapeFailure = onshapeError
    ? onshapeFailures[onshapeError]
    : undefined;

  return (
    <>
      {onshapeFailure && (
        <div className="p-4 w-full">
          <Alert variant="destructive">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>{onshapeFailure.title}</AlertTitle>
            <AlertDescription>{onshapeFailure.body}</AlertDescription>
          </Alert>
        </div>
      )}
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
