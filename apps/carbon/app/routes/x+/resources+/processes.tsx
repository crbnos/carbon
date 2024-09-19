import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ProcessesTable, getProcesses } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Processes",
  to: path.to.processes,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const processes = await getProcesses(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters,
  });

  if (processes.error) {
    throw redirect(
      path.to.resources,
      await flash(request, error(processes.error, "Failed to load processes"))
    );
  }

  return json({
    processes: processes.data ?? [],
    count: processes.count ?? 0,
  });
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
