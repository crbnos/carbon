import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getShifts } from "~/modules/people";
import { ShiftsTable } from "~/modules/people/ui/Shifts";
import { getLocations } from "~/modules/resources/resources.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Shifts`,
  to: path.to.shifts
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

  const [shifts, locations] = await Promise.all([
    getShifts({ search, limit, offset, sorts, filters }),
    getLocations()
  ]);

  if (shifts.error) {
    throw redirect(
      path.to.people,
      await flash(request, error(shifts.error, "Failed to load shifts"))
    );
  }

  return {
    shifts: shifts.data ?? [],
    locations: locations.data ?? [],
    count: shifts.count ?? 0
  };
}

export default function ShiftsRoute() {
  const { shifts, locations, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ShiftsTable data={shifts} count={count} locations={locations} />
      <Outlet />
    </VStack>
  );
}
