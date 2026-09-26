import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getRentalAgreements } from "~/modules/sales";
import { RentalAgreementsTable } from "~/modules/sales/ui/Rentals";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Rental Agreements`,
  to: path.to.rentalAgreements
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const rentalAgreements = await getRentalAgreements(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (rentalAgreements.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(rentalAgreements.error, "Failed to fetch rental agreements")
      )
    );
  }

  return {
    count: rentalAgreements.count ?? 0,
    rentalAgreements: rentalAgreements.data ?? []
  };
}

export default function RentalAgreementsRoute() {
  const { count, rentalAgreements } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <RentalAgreementsTable data={rentalAgreements} count={count} />
      <Outlet />
    </VStack>
  );
}
