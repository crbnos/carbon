import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  ToolsTable,
  getItemPostingGroupsList,
  getTools,
} from "~/modules/items";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Tools",
  to: path.to.tools,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [tools, itemPostingGroups] = await Promise.all([
    getTools(client, companyId, {
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters,
    }),
    getItemPostingGroupsList(client, companyId),
  ]);

  if (tools.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(tools.error, "Failed to fetch tools"))
    );
  }

  return json({
    count: tools.count ?? 0,
    tools: tools.data ?? [],
    itemPostingGroups: itemPostingGroups.data ?? [],
  });
}

export default function ToolsSearchRoute() {
  const { count, tools, itemPostingGroups } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ToolsTable
        data={tools}
        count={count}
        itemPostingGroups={itemPostingGroups}
      />
      <Outlet />
    </VStack>
  );
}
