// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { useRouteData } from "~/hooks";
import { getActiveFederationIssuers } from "~/modules/settings/settings.service";
import { ConnectWorkloadWizard } from "~/modules/settings/ui";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  const issuers = await getActiveFederationIssuers(client, companyId);
  if (issuers.error) {
    throw redirect(
      `${path.to.federationRules}?${getParams(request)}`,
      await flash(request, error(issuers.error, "Failed to load issuers"))
    );
  }

  return { issuers: issuers.data };
}

export default function ConnectWorkloadRoute() {
  const closeRoute = useCloseRoute();
  const navigate = useNavigate();
  const { issuers } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ companyId: string }>(
    path.to.federationRules
  );

  return (
    <ConnectWorkloadWizard
      issuers={issuers}
      companyId={routeData?.companyId}
      onClose={() => closeRoute()}
      onDone={(ruleId) => navigate(path.to.federationRule(ruleId))}
    />
  );
}
