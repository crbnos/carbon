import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { SalesRFQsTable, getSalesRFQs } from "~/modules/sales";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

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
