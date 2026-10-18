// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { arrayToTree } from "performant-array-to-tree";
import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import type { Group } from "~/modules/users/types";
import { GroupsTable } from "~/modules/users/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Groups`,
  to: path.to.groups
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "users",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const uid = searchParams.get("uid");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const groups = await api.users.getGroups({
    search,
    uid,
    limit,
    offset,
    sorts,
    filters
  });

  if (groups.error) {
    return data(
      { groups: [], count: 0, error: groups.error },
      await flash(request, error(groups.error, "Failed to load groups"))
    );
  }

  return {
    groups: (groups.data?.rows
      ? arrayToTree(groups.data?.rows)
      : []) as Group[],
    error: null,
    count: groups.data?.count ?? 0
  };
}

export default function GroupsRoute() {
  const { groups, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <GroupsTable data={groups} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
