import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { SalesRFQsTable, getSalesRFQs } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "RFQs",
  to: path.to.salesRfqs,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [rfqs] = await Promise.all([
    getSalesRFQs(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
  ]);

  if (rfqs.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(rfqs.error, "Failed to fetch RFQs"))
    );
  }

  return json({
    count: rfqs.count ?? 0,
    rfqs: rfqs.data ?? [],
  });
}

export default function RFQsRoute() {
  const { count, rfqs } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesRFQsTable data={rfqs} count={count} />
      <Outlet />
    </VStack>
  );
}
