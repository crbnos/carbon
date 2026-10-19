// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ToolsTable } from "~/modules/items/ui/Tools";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["item"],
  breadcrumb: msg`Tools`,
  to: path.to.tools
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(
    request,
    { "parts.tools": "View" },
    { bypassRls: true }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [tools, tags] = await Promise.all([
    api.items.getTools({
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters
    }),
    api.shared.getTagsList({ table: "tool" })
  ]);

  if (tools.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(tools.error, "Failed to fetch tools"))
    );
  }

  return {
    count: tools.data?.count ?? 0,
    tools: tools.data?.rows ?? [],
    tags: tags.data ?? []
  };
}

export default function ToolsSearchRoute() {
  const { count, tools, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ToolsTable data={tools} count={count} tags={tags} />
      <RecordOutlet />
    </VStack>
  );
}
