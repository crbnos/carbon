// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import AssemblyInstructionsTable from "~/modules/production/ui/Assemblies/AssemblyInstructionsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Assemblies`,
  to: path.to.assemblyInstructions
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId, api } = await authorize(
    request,
    { "production.assemblies": "View" },
    { role: "employee" }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset } = getGenericQueryFilters(searchParams);

  const instructions = await api.production.getAssemblyInstructions({
    companyId,
    search: search ?? undefined,
    limit,
    offset
  });

  return {
    instructions: instructions.data?.rows ?? [],
    count: instructions.data?.count ?? 0
  };
}

export default function AssemblyInstructionsRoute() {
  const { instructions, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <AssemblyInstructionsTable data={instructions} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
