// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { isUnaffectedByNavigation } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getAssemblyInstructions } from "~/modules/production";
import AssemblyInstructionsTable from "~/modules/production/ui/Assemblies/AssemblyInstructionsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Assemblies`,
  to: path.to.assemblyInstructions
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { search: "all" })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset } = getGenericQueryFilters(searchParams);

  const instructions = await getAssemblyInstructions(client, {
    companyId,
    search: search ?? undefined,
    limit,
    offset
  });

  return {
    instructions: instructions.data ?? [],
    count: instructions.count ?? 0
  };
}

export default function AssemblyInstructionsRoute() {
  const { instructions, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <AssemblyInstructionsTable data={instructions} count={count} />
      <Outlet />
    </VStack>
  );
}
