// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SuggestionsTable } from "~/modules/resources/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Suggestions`,
  to: path.to.suggestions
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(
    request,
    { "resources.suggestions": "View" },
    { role: "employee", bypassRls: true }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [suggestions, tags] = await Promise.all([
    api.resources.getSuggestions({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.shared.getTagsList({ table: "suggestion" })
  ]);

  if (suggestions.error) {
    throw redirect(
      path.to.resources,
      await flash(
        request,
        error(suggestions.error, "Failed to load suggestions")
      )
    );
  }

  return {
    suggestions: suggestions.data?.rows ?? [],
    tags: tags.data ?? [],
    count: suggestions.data?.count ?? 0
  };
}

export default function SuggestionsRoute() {
  const { suggestions, tags, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SuggestionsTable data={suggestions} tags={tags} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
