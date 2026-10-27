// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  EmployeeTypesTable,
  EmployeeTypesUpgradeOverlay
} from "~/modules/users/ui";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { employeeTypesList } from "~/utils/list-registry/users.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Employee Types`,
  to: path.to.employeeTypes
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, employeeTypesList, { dataKey: "data" });
}

export default function EmployeeTypesRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "PERMISSIONS" });

  if (isGated) {
    return <EmployeeTypesUpgradeOverlay />;
  }

  return (
    <VStack spacing={0} className="h-full">
      <EmployeeTypesTable
        data={data ?? []}
        count={count ?? 0}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
