import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { HolidaysTable, getHolidayYears, getHolidays } from "~/modules/people";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Holidays",
  to: path.to.holidays,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [holidays, years] = await Promise.all([
    getHolidays(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getHolidayYears(client, companyId),
  ]);

  if (holidays.error) {
    throw redirect(
      path.to.people,
      await flash(request, error(holidays.error, "Failed to load holidays"))
    );
  }

  return json({
    holidays: holidays.data ?? [],
    years:
      years?.data?.map((d) => d.year as number).sort((a, b) => b - a) ?? [],
    count: holidays.count ?? 0,
  });
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
