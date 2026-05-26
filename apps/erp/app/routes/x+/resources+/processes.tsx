import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { ProcessesTable } from "~/modules/resources";
import { getProcesses } from "~/modules/resources/resources.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Processes`,
  to: path.to.processes
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "resources",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const processes = await getProcesses({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (processes.error) {
    throw redirect(
      path.to.resources,
      await flash(request, error(processes.error, "Failed to load processes"))
    );
  }

  return {
    processes: processes.data ?? [],
    count: processes.count ?? 0
  };
}

export default function ProcessesRoute() {
  const { processes, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ProcessesTable data={processes} count={count} />
      <Outlet />
    </VStack>
  );
}
