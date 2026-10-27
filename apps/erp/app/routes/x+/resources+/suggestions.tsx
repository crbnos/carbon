// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SuggestionsTable } from "~/modules/resources/ui";
import { getTagsList } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { suggestionsList } from "~/utils/list-registry/resources.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Suggestions`,
  to: path.to.suggestions
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, suggestionsList, {
    dataKey: "suggestions",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => ({
      tags: (await getTagsList(client, companyId, "suggestion")).data ?? []
    }),
    onError: {
      redirectTo: path.to.resources,
      message: "Failed to load suggestions"
    }
  });
}

export default function SuggestionsRoute() {
  const { suggestions, tags, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SuggestionsTable
        data={suggestions}
        tags={tags}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
