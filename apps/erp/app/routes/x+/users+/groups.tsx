import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { arrayToTree } from "performant-array-to-tree";
import type { LoaderFunctionArgs } from "react-router";
import { data, Outlet, useLoaderData } from "react-router";
import type { Group } from "~/modules/users";
import { GroupsTable } from "~/modules/users";
import { getGroups } from "~/modules/users/users.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Groups`,
  to: path.to.groups
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "users",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const uid = searchParams.get("uid");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const groups = await getGroups({
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
    groups: (groups.data ? arrayToTree(groups.data) : []) as Group[],
    error: null,
    count: groups.count ?? 0
  };
}

export default function GroupsRoute() {
  const { groups, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      {/* @ts-ignore */}
      <GroupsTable data={groups} count={count} />
      <Outlet />
    </VStack>
  );
}
