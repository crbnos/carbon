// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import { getConfig } from "~/modules/settings/settings.service";
import {
  WebhooksTable,
  WebhooksUpgradeOverlay
} from "~/modules/settings/ui/Webhooks";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { webhooksList } from "~/utils/list-registry/settings.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Webhooks`,
  to: path.to.webhooks
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, webhooksList, {
    dataKey: "webhooks",
    firstPage: async ({ client }) => {
      const config = await getConfig(client);
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
      return { config: config.data ?? null };
    },
    onError: {
      redirectTo: path.to.settings,
      message: "Failed to load webhooks"
    }
  });
}

export default function WebhooksRoute() {
  const { webhooks, count, infinite } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "WEBHOOKS" });

  if (isGated) {
    return <WebhooksUpgradeOverlay />;
  }
  return (
    <>
      <WebhooksTable count={count} data={webhooks} infinite={infinite} />
      <RecordOutlet />
    </>
  );
}
