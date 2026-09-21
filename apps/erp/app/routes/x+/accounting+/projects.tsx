import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { data, Outlet, useLoaderData } from "react-router";
import { getProjects } from "~/modules/accounting";
import { ProjectsTable } from "~/modules/accounting/ui/Projects";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Projects`,
  to: path.to.projects
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const projects = await getProjects(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (projects.error) {
    return data(
      { data: [], count: 0 },
      await flash(request, error(projects.error, "Failed to fetch projects"))
    );
  }

  return { data: projects.data ?? [], count: projects.count ?? 0 };
}

export default function ProjectsRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ProjectsTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
