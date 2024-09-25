import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
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
    integrations: integrations.data ?? [],
  };
}

export default function IntegrationsRoute() {
  const { integrations } = useLoaderData<typeof loader>();

  return (
    <>
      <IntegrationsList integrations={integrations} />
      <Outlet />
    </>
  );
}
