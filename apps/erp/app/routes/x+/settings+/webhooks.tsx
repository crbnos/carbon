import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  getConfig,
  getWebhooks
} from "~/modules/settings/settings.service.server";
import {
  WebhooksTable,
  WebhooksUpgradeOverlay
} from "~/modules/settings/ui/Webhooks";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Webhooks`,
  to: path.to.webhooks
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "settings"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [webhooks, config] = await Promise.all([
    getWebhooks({
      limit,
      offset,
      sorts,
      search,
      filters
    }),
    getConfig()
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

  return {
    webhooks: webhooks.data ?? [],
    count: webhooks.count ?? 0,
    config: config.data ?? null
  };
}

export default function WebhooksRoute() {
  const { webhooks, count } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "WEBHOOKS" });

  if (isGated) {
    return <WebhooksUpgradeOverlay />;
  }
  return (
    <>
      <WebhooksTable count={count} data={webhooks} />
      <Outlet />
    </>
  );
}
