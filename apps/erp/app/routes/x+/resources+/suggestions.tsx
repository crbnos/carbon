import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { SuggestionsTable } from "~/modules/resources";
import { getSuggestions } from "~/modules/resources/resources.service.server";
import { getTagsList } from "~/modules/shared/shared.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Suggestions`,
  to: path.to.suggestions
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
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
    getSuggestions({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList("suggestion")
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
