import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { ChargesTable, getCharges } from "~/modules/invoicing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Charges",
  to: path.to.charges,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const search = searchParams.get("search");
  const type = searchParams.get("type") as
    | "Charge"
    | "Credit"
    | "Payment"
    | "Cashback"
    | "Repayment"
    | null;
  const status = searchParams.get("status") as
    | "Draft"
    | "Posted"
    | "Voided"
    | null;

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const charges = await getCharges(client, companyId, {
    search,
    type,
    status,
    limit,
    offset,
    sorts,
    filters
  });

  if (charges.error) {
    throw redirect(
      path.to.invoicing,
      await flash(request, error(charges.error, "Failed to fetch charges"))
    );
  }

  return {
    count: charges.count ?? 0,
    data: charges.data ?? []
  };
}

export default function ChargesRoute() {
  const { count, data } = useLoaderData<typeof loader>();
  return (
    <VStack spacing={0} className="h-full">
      <ChargesTable data={data} count={count} />
      <Outlet />
    </VStack>
  );
}
