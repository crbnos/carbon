import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getQuotes } from "~/modules/sales";
import { QuotesTable } from "~/modules/sales/ui/Quotes";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Quotes`,
  to: path.to.quotes
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const quotes = await getQuotes({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (quotes.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(quotes.error, "Failed to fetch quotes"))
    );
  }

  return {
    count: quotes.count ?? 0,
    quotes: quotes.data ?? []
  };
}

export default function QuotesRoute() {
  const { count, quotes } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <QuotesTable data={quotes} count={count} />
      <Outlet />
    </VStack>
  );
}
