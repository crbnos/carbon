// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { MethodMaterialsTable } from "~/modules/items/ui/Methods";
import type { Handle } from "~/utils/handle";
import { methodMaterialsList } from "~/utils/list-registry/items.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Method Materials`,
  to: path.to.methodMaterials
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, methodMaterialsList, {
    dataKey: "materials",
    onError: {
      redirectTo: path.to.production,
      message: "Failed to fetch method materials"
    }
  });
}

export default function MethodMaterialsRoute() {
  const { count, materials, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack
      spacing={0}
      className="h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]"
    >
      <MethodMaterialsTable
        data={materials}
        count={count}
        infinite={infinite}
      />
    </VStack>
  );
}
