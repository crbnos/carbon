import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getProcedures } from "~/modules/production/production.service.server";
import ProceduresTable from "~/modules/production/ui/Procedures/ProceduresTable";
import { getTagsList } from "~/modules/shared/shared.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Procedures`,
  to: path.to.procedures
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [procedures, tags] = await Promise.all([
    getProcedures({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList("procedure")
  ]);

  return {
    procedures: procedures.data ?? [],
    tags: tags.data ?? [],
    count: procedures.count ?? 0
  };
}

export default function ProceduresRoute() {
  const { procedures, tags, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ProceduresTable data={procedures} tags={tags} count={count} />
      <Outlet />
    </VStack>
  );
}
