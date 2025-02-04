import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Outlet, useLoaderData } from "@remix-run/react";
import { json, redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { getConfig, getWebhooks } from "~/modules/settings";
import { WebhooksTable } from "~/modules/settings/ui/Webhooks";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Webhooks",
  to: path.to.webhooks,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [webhooks, config] = await Promise.all([
    getWebhooks(client, companyId, {
      limit,
      offset,
      sorts,
      search,
      filters,
    }),
    getConfig(client),
  ]);

  if (webhooks.error) {
    throw redirect(
      path.to.settings,
      await flash(request, error(webhooks.error, "Failed to load webhooks"))
    );
  }

  if (config.error || !config.data?.apiUrl) {
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(
          config.error,
          "Failed to load config. Please make sure a valid record exists in your public.config table."
        )
      )
    );
  }

  return json({
    webhooks: webhooks.data ?? [],
    count: webhooks.count ?? 0,
    config: config.data,
  });
}

export default function WebhooksRoute() {
  const { webhooks, count } = useLoaderData<typeof loader>();
  return (
    <>
      <WebhooksTable count={count} data={webhooks} />
      <Outlet />
    </>
  );
}
