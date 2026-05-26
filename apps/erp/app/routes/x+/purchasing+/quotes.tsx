import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getSupplierQuotes } from "~/modules/purchasing/purchasing.service.server";
import { SupplierQuotesTable } from "~/modules/purchasing/ui/SupplierQuote";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Supplier Quotes`,
  to: path.to.supplierQuotes
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const quotes = await getSupplierQuotes({
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

export default function SupplierQuotesRoute() {
  const { count, quotes } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SupplierQuotesTable data={quotes} count={count} />
      <Outlet />
    </VStack>
  );
}
