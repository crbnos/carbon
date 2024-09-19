import { Outlet, useLoaderData } from "@remix-run/react";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { IntegrationsList, getIntegrations } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

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
