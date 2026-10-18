// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  RecordOutlet,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
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

  const unregistered = countriesWithoutRegistration.join(", ");
  const uncovered = countriesWithoutCode.join(", ");

  return (
    <VStack spacing={0} className="h-full">
      {countriesWithoutRegistration.length > 0 && (
        <div className="w-full p-4 pb-0">
          <Alert variant="warning">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>
              <Trans>No tax registration for {unregistered}</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                An active tax code charges tax in these countries, but the
                company has no tax registration there.
              </Trans>
            </AlertDescription>
          </Alert>
        </div>
      )}
      {countriesWithoutCode.length > 0 && (
        <div className="w-full p-4 pb-0">
          <Alert variant="warning">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>
              <Trans>No active tax code for {uncovered}</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                The company is registered in these countries, but no active tax
                code charges tax there.
              </Trans>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className="flex-1 min-h-0 w-full">
        <TaxRegistrationsTable data={data ?? []} count={count ?? 0} />
      </div>
      <RecordOutlet />
    </VStack>
  );
}
