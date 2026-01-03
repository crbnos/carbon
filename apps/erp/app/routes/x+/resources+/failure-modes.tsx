import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getFailureModes } from "~/modules/resources";
import FailureModesTable from "~/modules/resources/ui/FailureModes/FailureModesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Failure Modes",
  to: path.to.failureModes
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  return await getFailureModes(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function FailureModesRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <FailureModesTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
