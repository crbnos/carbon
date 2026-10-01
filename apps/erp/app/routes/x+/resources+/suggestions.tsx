// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { isUnaffectedByNavigation } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getSuggestions, SuggestionsTable } from "~/modules/resources";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Suggestions`,
  to: path.to.suggestions
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { search: "all" })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [suggestions, tags] = await Promise.all([
    getSuggestions(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList(client, companyId, "suggestion")
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
    suggestions: suggestions.data ?? [],
    tags: tags.data ?? [],
    count: suggestions.count ?? 0
  };
}

export default function SuggestionsRoute() {
  const { suggestions, tags, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SuggestionsTable data={suggestions} tags={tags} count={count} />
      <Outlet />
    </VStack>
  );
}
