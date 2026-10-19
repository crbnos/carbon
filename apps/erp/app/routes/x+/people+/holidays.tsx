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
import { HolidaysTable } from "~/modules/people/ui/Holidays";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Holidays`,
  to: path.to.holidays
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(
    request,
    { "people.holidays": "View" },
    { role: "employee", bypassRls: true }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [holidays, years] = await Promise.all([
    api.people.getHolidays({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.people.getHolidayYears({})
  ]);

  if (holidays.error) {
    throw redirect(
      path.to.people,
      await flash(request, error(holidays.error, "Failed to load holidays"))
    );
  }

  return {
    holidays: holidays.data?.rows ?? [],
    years:
      years?.data?.map((d) => d.year as number).sort((a, b) => b - a) ?? [],
    count: holidays.data?.count ?? 0
  };
}

export default function Route() {
  const { holidays, years, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <HolidaysTable data={holidays} count={count} years={years} />
      <RecordOutlet />
    </VStack>
  );
}
