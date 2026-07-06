import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getPickingLists } from "~/modules/inventory";
import type { PickingList } from "~/modules/inventory/ui/PickingLists";
import { PickingListsTable } from "~/modules/inventory/ui/PickingLists";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Picking Lists`,
  to: path.to.pickingLists
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const assignee = searchParams.get("assignee");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const pickingLists = await getPickingLists(client, companyId, {
    search,
    status,
    assignee,
    locationId: null,
    limit,
    offset,
    sorts,
    filters
  });

  if (pickingLists.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(pickingLists.error, "Error loading picking lists")
      )
    );
  }

  return {
    pickingLists: pickingLists.data ?? [],
    pickingListCount: pickingLists.count ?? 0
  };
}

export default function PickingListsRoute() {
  const { pickingLists, pickingListCount } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PickingListsTable
        data={pickingLists as PickingList[]}
        count={pickingListCount}
      />
      <Outlet />
    </VStack>
  );
}
