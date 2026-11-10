// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getChangeNoticeTypesList } from "~/modules/items/items.service";
import { ChangeNoticesTable } from "~/modules/items/ui/ChangeNotice";
import { changeNoticesList } from "~/utils/list-registry/items.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, changeNoticesList, {
    dataKey: "changeNotices",
    firstPage: async ({ client, companyId }) => ({
      types: (await getChangeNoticeTypesList(client, companyId)).data ?? []
    }),
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Error loading change notices"
    }
  });
}

export default function ChangeNoticesIndexRoute() {
  const { changeNotices, count, infinite, types } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ChangeNoticesTable
        data={changeNotices}
        count={count}
        infinite={infinite}
        types={types}
      />
      <RecordOutlet />
    </VStack>
  );
}
