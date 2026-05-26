import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { ReceiptsTable } from "~/modules/inventory";
import { getReceipts } from "~/modules/inventory/inventory.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Receipts`,
  to: path.to.receipts
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const receipts = await getReceipts({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (receipts.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(null, "Error loading receipts"))
    );
  }

  return {
    receipts: receipts.data ?? [],
    count: receipts.count ?? 0
  };
}

export default function ReceiptsRoute() {
  const { receipts, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ReceiptsTable data={receipts} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
