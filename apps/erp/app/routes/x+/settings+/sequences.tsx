// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SequencesTable } from "~/modules/settings/ui";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { sequencesList } from "~/utils/list-registry/settings.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Sequences`,
  to: path.to.sequences
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, sequencesList, { dataKey: "data" });
}

export default function SequencesRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SequencesTable
        data={data ?? []}
        count={count ?? 0}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
