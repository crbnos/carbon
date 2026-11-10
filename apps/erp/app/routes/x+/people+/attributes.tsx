// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getAttributeDataTypes } from "~/modules/people/people.service";
import { AttributeCategoriesTable } from "~/modules/people/ui/Attributes";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { attributeCategoriesList } from "~/utils/list-registry/people.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Attributes`,
  to: path.to.attributes
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, attributeCategoriesList, {
    dataKey: "categories",
    firstPage: async ({ client }) => ({
      dataTypes: (await getAttributeDataTypes(client)).data ?? []
    }),
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch attribute categories"
    }
  });
}

export default function UserAttributesRoute() {
  const { count, categories, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <AttributeCategoriesTable
        data={categories}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
