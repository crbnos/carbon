// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import { getUnattributedMachineTimes } from "~/modules/production";
import MachineTimeTable from "~/modules/production/ui/MachineTime/MachineTimeTable.ee";
import MachineTimeUpgradeOverlay from "~/modules/production/ui/MachineTime/MachineTimeUpgradeOverlay.ee";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Unattributed Machine Time`,
  to: path.to.unattributedMachineTimes
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const machineTimes = await getUnattributedMachineTimes(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (machineTimes.error) {
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(machineTimes.error, "Failed to load unattributed machine time")
      )
    );
  }

  return {
    machineTimes: machineTimes.data ?? [],
    count: machineTimes.count ?? 0
  };
}

export default function MachineTimeRoute() {
  const { machineTimes, count } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "INTEGRATIONS" });

  if (isGated) {
    return <MachineTimeUpgradeOverlay />;
  }

  return (
    <VStack spacing={0} className="h-full">
      <MachineTimeTable data={machineTimes} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
