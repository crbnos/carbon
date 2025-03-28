import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getNonConformanceTemplates } from "~/modules/quality";
import NonConformanceTemplatesTable from "~/modules/quality/ui/NonConformanceTemplates/NonConformanceTemplatesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Non-Conformance Templates",
  to: path.to.nonConformanceTemplates,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const procedures = await getNonConformanceTemplates(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters,
  });

  return json({
    procedures: procedures.data ?? [],
    count: procedures.count ?? 0,
  });
}

export default function NonConformanceTemplatesRoute() {
  const { procedures, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <NonConformanceTemplatesTable data={procedures} count={count} />
      <Outlet />
    </VStack>
  );
}
