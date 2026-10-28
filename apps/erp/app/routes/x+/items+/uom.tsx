// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { UnitOfMeasuresTable } from "~/modules/items/ui/UnitOfMeasure";
import type { Handle } from "~/utils/handle";
import { unitOfMeasuresList } from "~/utils/list-registry/items.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Unit of Measures`,
  to: path.to.uoms
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, unitOfMeasuresList, { dataKey: "data" });
}

export default function UnitOfMeasuresRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <UnitOfMeasuresTable data={data} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
