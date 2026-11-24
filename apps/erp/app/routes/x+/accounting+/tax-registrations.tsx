// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getTaxRegistrations } from "~/modules/accounting/accounting.service";
import { TaxRegistrationsTable } from "~/modules/accounting/ui/Tax";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Tax Registrations`,
  to: path.to.taxRegistrations
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  // The list is paged and filtered, so the country checks read every active
  // code and every registration on their own.
  const [registrations, activeCodeCountries, registeredCountries] =
    await Promise.all([
      getTaxRegistrations(client, companyId, {
        search,
        limit,
        offset,
        sorts,
        filters
      }),
      client
        .from("taxCode")
        .select("countryCode, country(name)")
        .eq("companyId", companyId)
        .eq("active", true)
        .not("countryCode", "is", null),
      client
        .from("taxRegistration")
        .select("countryCode, country(name)")
        .eq("companyId", companyId)
    ]);

  const countryNames = new Map<string, string>();
  const codeCountries = new Set<string>();
  for (const code of activeCodeCountries.data ?? []) {
    if (!code.countryCode) continue;
    codeCountries.add(code.countryCode);
    countryNames.set(code.countryCode, code.country?.name ?? code.countryCode);
  }
  const registrationCountries = new Set<string>();
  for (const registration of registeredCountries.data ?? []) {
    registrationCountries.add(registration.countryCode);
    countryNames.set(
      registration.countryCode,
      registration.country?.name ?? registration.countryCode
    );
  }

  const toNames = (codes: string[]) =>
    codes
      .map((code) => countryNames.get(code) ?? code)
      .sort((a, b) => a.localeCompare(b));

  return {
    data: registrations.data,
    count: registrations.count,
    countriesWithoutRegistration: toNames(
      [...codeCountries].filter((code) => !registrationCountries.has(code))
    ),
    countriesWithoutCode: toNames(
      [...registrationCountries].filter((code) => !codeCountries.has(code))
    )
  };
}

export default function TaxRegistrationsRoute() {
  const { data, count, countriesWithoutRegistration, countriesWithoutCode } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TaxRegistrationsTable
        data={data ?? []}
        count={count ?? 0}
        countriesWithoutRegistration={countriesWithoutRegistration}
        countriesWithoutCode={countriesWithoutCode}
      />
      <RecordOutlet />
    </VStack>
  );
}
