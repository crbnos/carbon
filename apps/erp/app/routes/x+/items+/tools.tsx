// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ToolsTable } from "~/modules/items/ui/Tools";
import { getTagsList } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { toolsList } from "~/utils/list-registry/items.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["item"],
  breadcrumb: msg`Tools`,
  to: path.to.tools
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, toolsList, {
    dataKey: "tools",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => ({
      tags: (await getTagsList(client, companyId, "tool")).data ?? []
    }),
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch tools"
    }
  });
}

export default function ToolsSearchRoute() {
  const { count, tools, infinite, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ToolsTable data={tools} count={count} infinite={infinite} tags={tags} />
      <RecordOutlet />
    </VStack>
  );
}
