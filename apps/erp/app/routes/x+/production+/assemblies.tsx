// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import AssemblyInstructionsTable from "~/modules/production/ui/Assemblies/AssemblyInstructionsTable";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { assemblyInstructionsList } from "~/utils/list-registry/production.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Assemblies`,
  to: path.to.assemblyInstructions
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, assemblyInstructionsList, {
    dataKey: "instructions"
  });
}

export default function AssemblyInstructionsRoute() {
  const { instructions, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <AssemblyInstructionsTable
        data={instructions}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
