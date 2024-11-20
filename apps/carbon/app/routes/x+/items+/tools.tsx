import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ToolsTable, getTools } from "~/modules/items";
import { getTagsList } from "~/modules/shared";
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

  const [tools, tags] = await Promise.all([
    getTools(client, companyId, {
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters,
    }),
    getTagsList(client, companyId, "tool"),
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
    tags: tags.data ?? [],
  });
}

export default function ToolsSearchRoute() {
  const { count, tools, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ToolsTable data={tools} count={count} tags={tags} />
      <Outlet />
    </VStack>
  );
}
