// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { MethodOperationsTable } from "~/modules/items/ui/Methods";
import type { Handle } from "~/utils/handle";
import { methodOperationsList } from "~/utils/list-registry/items.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Method Operations`,
  to: path.to.methodOperations
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, methodOperationsList, {
    dataKey: "operations",
    onError: {
      redirectTo: path.to.production,
      message: "Failed to fetch method operations"
    }
  });
}

export default function MethodOperationsRoute() {
  const { count, operations, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack
      spacing={0}
      className="h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]"
    >
      <MethodOperationsTable
        data={operations}
        count={count}
        infinite={infinite}
      />
    </VStack>
  );
}
