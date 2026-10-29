// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { MaterialFormsTable } from "~/modules/items/ui/MaterialShapes";
import type { Handle } from "~/utils/handle";
import { materialFormsList } from "~/utils/list-registry/items.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Shapes`,
  to: path.to.materialForms
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, materialFormsList, {
    dataKey: "materialForms",
    onError: {
      redirectTo: path.to.items,
      message: "Error loading material forms"
    }
  });
}

export default function MaterialFormsRoute() {
  const { materialForms, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialFormsTable
        data={materialForms}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
