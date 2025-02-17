import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getProcedures } from "~/modules/production";
import ProceduresTable from "~/modules/production/ui/Procedures/ProceduresTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Procedures",
  to: path.to.procedures,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const procedures = await getProcedures(client, companyId, {
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

export default function ProceduresRoute() {
  const { procedures, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ProceduresTable data={procedures} count={count} />
      <Outlet />
    </VStack>
  );
}
