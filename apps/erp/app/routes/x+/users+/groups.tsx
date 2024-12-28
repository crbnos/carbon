import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { arrayToTree } from "performant-array-to-tree";
import type { Group } from "~/modules/users";
import { GroupsTable, getGroups } from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Groups",
  to: path.to.groups,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const uid = searchParams.get("uid");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const groups = await getGroups(client, companyId, {
    search,
    uid,
    limit,
    offset,
    sorts,
    filters,
  });

  if (groups.error) {
    return json(
      { groups: [], count: 0, error: groups.error },
      await flash(request, error(groups.error, "Failed to load groups"))
    );
  }

  return json({
    groups: (groups.data ? arrayToTree(groups.data) : []) as Group[],
    error: null,
    count: groups.count ?? 0,
  });
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
