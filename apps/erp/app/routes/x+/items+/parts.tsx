// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { PartsTable } from "~/modules/items/ui/Parts";
import { getTagsList } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { partsList } from "~/utils/list-registry/items.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";
import { useRealtime } from "../../../hooks";

export const handle: Handle = {
  realtime: ["item"],
  breadcrumb: msg`Parts`,
  to: path.to.parts
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, partsList, {
    dataKey: "parts",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => ({
      tags: (await getTagsList(client, companyId, "part")).data ?? []
    }),
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch parts"
    }
  });
}

export default function PartsSearchRoute() {
  const { count, parts, infinite, tags } = useLoaderData<typeof loader>();

  useRealtime("part");

  return (
    <VStack spacing={0} className="h-full">
      <PartsTable data={parts} count={count} infinite={infinite} tags={tags} />
      <RecordOutlet />
    </VStack>
  );
}
