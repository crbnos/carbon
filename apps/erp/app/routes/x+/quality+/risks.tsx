// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import RiskRegistersTable from "~/modules/quality/ui/RiskRegister/RiskRegistersTable";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { risksList } from "~/utils/list-registry/quality.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Risks`,
  to: path.to.risks
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, risksList, {
    dataKey: "risks",
    onError: { redirectTo: path.to.quality, message: "Failed to fetch risks" }
  });
}

export default function RisksRoute() {
  const { count, risks, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <RiskRegistersTable data={risks} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
