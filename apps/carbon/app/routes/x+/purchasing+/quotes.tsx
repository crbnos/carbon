import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getSupplierQuotes } from "~/modules/purchasing/purchasing.service";
import { SupplierQuotesTable } from "~/modules/purchasing/ui/SupplierQuote";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Supplier Quotes",
  to: path.to.supplierQuotes,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [quotes] = await Promise.all([
    getSupplierQuotes(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
  ]);

  if (quotes.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(quotes.error, "Failed to fetch quotes"))
    );
  }

  return json({
    count: quotes.count ?? 0,
    quotes: quotes.data ?? [],
  });
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
