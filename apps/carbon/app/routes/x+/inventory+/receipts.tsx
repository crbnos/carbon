import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ReceiptsTable, getReceipts } from "~/modules/inventory";
import { getLocationsList } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Receipts",
  to: path.to.receipts,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [receipts, locations] = await Promise.all([
    getReceipts(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getLocationsList(client, companyId),
  ]);

  if (receipts.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(null, "Error loading receipts"))
    );
  }

  return json({
    receipts: receipts.data ?? [],
    count: receipts.count ?? 0,
    locations: locations.data ?? [],
  });
}

export default function ReceiptsRoute() {
  const { receipts, count, locations } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ReceiptsTable data={receipts} count={count ?? 0} locations={locations} />
      <Outlet />
    </VStack>
  );
}
