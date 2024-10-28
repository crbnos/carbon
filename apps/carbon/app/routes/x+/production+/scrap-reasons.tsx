import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getScrapReasons } from "~/modules/production";
import ScrapReasonsTable from "~/modules/production/ui/ScrapReasons/ScrapReasonsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Scrap Reasons",
  to: path.to.scrapReasons,
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

  return json(
    await getScrapReasons(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    })
  );
}

export default function ScrapReasonsRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ScrapReasonsTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
