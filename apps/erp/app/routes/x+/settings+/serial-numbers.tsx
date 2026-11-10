// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ItemSerialSequencesTable } from "~/modules/settings/ui";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { itemSerialSequencesList } from "~/utils/list-registry/settings.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Serial Numbers`,
  to: path.to.serialNumberSequences
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, itemSerialSequencesList, { dataKey: "data" });
}

export default function SerialNumbersRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ItemSerialSequencesTable
        data={data ?? []}
        count={count ?? 0}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
