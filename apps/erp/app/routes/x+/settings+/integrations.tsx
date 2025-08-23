import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { integrations as availableIntegrations } from "@carbon/ee";
import { Outlet, useLoaderData } from "@remix-run/react";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { IntegrationsList, getIntegrations } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
  });

  const integrations = await getIntegrations(client, companyId);
  if (integrations.error) {
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(integrations.error, "Failed to load integrations")
      )
    );
  }

  return {
    installedIntegrations: (integrations.data
      .filter((i) => i.active)
      .map((i) => i.id) ?? []) as string[],
  };
}

export default function IntegrationsRoute() {
  const { installedIntegrations } = useLoaderData<typeof loader>();

  return (
    <>
      <IntegrationsList
        installedIntegrations={installedIntegrations}
        availableIntegrations={availableIntegrations}
      />
      <Outlet />
    </>
  );
}
