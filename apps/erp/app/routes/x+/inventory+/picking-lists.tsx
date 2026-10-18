// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { PickingList } from "~/modules/inventory/ui/PickingLists";
import { PickingListsTable } from "~/modules/inventory/ui/PickingLists";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["pickingList"],
  breadcrumb: msg`Picking Lists`,
  to: path.to.pickingLists
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const assignee = searchParams.get("assignee");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const pickingLists = await api.inventory.getPickingLists({
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
    pickingLists: pickingLists.data?.rows ?? [],
    pickingListCount: pickingLists.data?.count ?? 0
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
      <RecordOutlet />
    </VStack>
  );
}
