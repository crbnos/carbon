// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  getUnattributedMachineTimes,
  UNATTRIBUTED_MACHINE_TIMES_PAGING
} from "~/modules/production/production.service";
import MachineTimeTable from "~/modules/production/ui/MachineTime/MachineTimeTable.ee";
import MachineTimeUpgradeOverlay from "~/modules/production/ui/MachineTime/MachineTimeUpgradeOverlay.ee";
import { parseMachineTimeListFilters } from "~/modules/production/ui/MachineTime/machine-time-filters.ee";
import {
  getLocationsList,
  getWorkCentersList
} from "~/modules/resources/resources.service";
import { toPage } from "~/utils/cursor";
import type { Handle } from "~/utils/handle";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "machine-time");

export const handle: Handle = {
  breadcrumb: msg`Unattributed Time`,
  to: path.to.unattributedMachineTimes
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const { limit, cursor } = getGenericQueryFilters(searchParams);
  const filters = parseMachineTimeListFilters(searchParams);

  const [machineTimes, workCenters, locations] = await Promise.all([
    getUnattributedMachineTimes(client, companyId, { filters, limit, cursor }),
    getWorkCentersList(client, companyId),
    getLocationsList(client, companyId)
  ]);

  if (machineTimes.error) {
    if (cursor) {
      logger.error("Failed to load a later page of unattributed machine time", {
        companyId,
        error: machineTimes.error
      });
      return listErrorPage("machineTimes");
    }
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(machineTimes.error, "Failed to load unattributed machine time")
      )
    );
  }

  const page = toPage(
    machineTimes.data ?? [],
    { limit, sorts: [] },
    UNATTRIBUTED_MACHINE_TIMES_PAGING
  );

  return {
    machineTimes: page.rows,
    count: machineTimes.count ?? 0,
    nextCursor: page.nextCursor,
    workCenters: workCenters.data ?? [],
    locations: locations.data ?? []
  };
}

export default function MachineTimeRoute() {
  const { machineTimes, count, nextCursor, workCenters, locations } =
    useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "INTEGRATIONS" });

  if (isGated) {
    return <MachineTimeUpgradeOverlay />;
  }

  return (
    <VStack spacing={0} className="h-full">
      <MachineTimeTable
        data={machineTimes}
        count={count}
        nextCursor={nextCursor}
        workCenters={workCenters}
        locations={locations}
      />
      <RecordOutlet />
    </VStack>
  );
}
