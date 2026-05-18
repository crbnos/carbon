import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getHolidays, getHolidayYears } from "~/modules/people";
import { HolidaysTable } from "~/modules/people/ui/Holidays";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Holidays`,
  to: path.to.holidays
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [holidays, years] = await Promise.all([
    getHolidays({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getHolidayYears()
  ]);

  if (holidays.error) {
    throw redirect(
      path.to.people,
      await flash(request, error(holidays.error, "Failed to load holidays"))
    );
  }

  return {
    holidays: holidays.data ?? [],
    years:
      years?.data?.map((d) => d.year as number).sort((a, b) => b - a) ?? [],
    count: holidays.count ?? 0
  };
}

export default function Route() {
  const { holidays, years, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <HolidaysTable data={holidays} count={count} years={years} />
      <Outlet />
    </VStack>
  );
}
