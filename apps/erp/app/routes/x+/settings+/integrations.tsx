import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  integrations as availableIntegrations,
  quickInstallConnectors
} from "@carbon/ee";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
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
