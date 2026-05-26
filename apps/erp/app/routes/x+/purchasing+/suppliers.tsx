import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getSuppliers } from "~/modules/purchasing/purchasing.service.server";
import { SuppliersTable } from "~/modules/purchasing/ui/Supplier";
import { getTagsList } from "~/modules/shared/shared.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Suppliers`,
  to: path.to.suppliers
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [suppliers, tags] = await Promise.all([
    getSuppliers({
      search,
      type,
      status,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList("supplier")
  ]);

  if (suppliers.error) {
    redirect(
      path.to.purchasing,
      await flash(request, error(suppliers.error, "Failed to fetch suppliers"))
    );
  }

  return {
    count: suppliers.count ?? 0,
    suppliers: suppliers.data ?? [],
    tags: tags.data ?? []
  };
}

export default function PurchasingSuppliersRoute() {
  const { count, suppliers, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SuppliersTable data={suppliers} count={count} tags={tags} />
      <Outlet />
    </VStack>
  );
}
