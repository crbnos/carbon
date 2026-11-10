// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ChangeNoticeRequiredActionsTable } from "~/modules/items/ui/ChangeNoticeActions";
import type { Handle } from "~/utils/handle";
import { changeNoticeRequiredActionsList } from "~/utils/list-registry/items.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Change Notice Actions`,
  to: path.to.changeNoticeRequiredActions
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, changeNoticeRequiredActionsList, {
    dataKey: "data"
  });
}

export default function ChangeNoticeActionsRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ChangeNoticeRequiredActionsTable
        data={data}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
