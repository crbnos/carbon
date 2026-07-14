import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getAssemblyInstructions } from "~/modules/production";
import { requireAssembliesInternal } from "~/modules/production/production.server";
import AssemblyInstructionsTable from "~/modules/production/ui/Assemblies/AssemblyInstructionsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Assemblies`,
  to: path.to.assemblyInstructions
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });
  requireAssembliesInternal(email);

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
