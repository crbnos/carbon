import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getCurrencies, getExchangeRates } from "~/modules/accounting";
import { ExchangeRatesTable } from "~/modules/accounting/ui/ExchangeRates";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Exchange Rates`,
  to: path.to.exchangeRates
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting",
      role: "employee"
    }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [currencies, exchangeRates] = await Promise.all([
    getCurrencies(client, companyGroupId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getExchangeRates(client, companyId)
  ]);

  // A broken rates page must not be indistinguishable from a healthy one —
  // this is the screen that administers the rates.
  if (currencies.error || exchangeRates.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(
          currencies.error ?? exchangeRates.error,
          "Failed to load exchange rates"
        )
      )
    );
  }

  const resolvedByCode = new Map(
    (exchangeRates.data ?? []).map((rate) => [rate.currencyCode, rate])
  );

  return {
    count: currencies.count ?? 0,
    data: (currencies.data ?? []).map((currency) => {
      const resolved = currency.code
        ? resolvedByCode.get(currency.code)
        : undefined;
      return {
        ...currency,
        rate: resolved?.rate ?? null,
        rateSource: resolved?.source ?? null,
        rateUpdatedAt: resolved?.rateUpdatedAt ?? null
      };
    })
  };
}

export default function ExchangeRatesRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ExchangeRatesTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
