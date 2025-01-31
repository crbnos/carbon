import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getBatches } from "~/modules/inventory";
import BatchesTable from "~/modules/inventory/ui/Batches/BatchesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Batches",
  to: path.to.batches,
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

  const [batches] = await Promise.all([
    getBatches(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
  ]);

  if (batches.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(null, "Error loading batches"))
    );
  }

  return json({
    batches: batches.data ?? [],
    count: batches.count ?? 0,
  });
}

export default function ReceiptsRoute() {
  const { batches, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <BatchesTable data={batches} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
