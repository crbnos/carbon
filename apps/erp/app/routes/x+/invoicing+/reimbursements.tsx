import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getReimbursements, ReimbursementsTable } from "~/modules/invoicing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Reimbursements",
  to: path.to.reimbursements,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const search = searchParams.get("search");
  const status = searchParams.get("status") as
    | "Draft"
    | "Posted"
    | "Voided"
    | null;
  const employeeId = searchParams.get("employeeId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const reimbursements = await getReimbursements(client, companyId, {
    search,
    status,
    employeeId,
    limit,
    offset,
    sorts,
    filters
  });

  if (reimbursements.error) {
    throw redirect(
      path.to.invoicing,
      await flash(
        request,
        error(reimbursements.error, "Failed to fetch reimbursements")
      )
    );
  }

  return {
    count: reimbursements.count ?? 0,
    data: reimbursements.data ?? []
  };
}

export default function ReimbursementsRoute() {
  const { count, data } = useLoaderData<typeof loader>();
  // No <Outlet /> — unlike charges, the reimbursement detail is a full page of
  // its own rather than a Drawer child of this list.
  return (
    <VStack spacing={0} className="h-full">
      <ReimbursementsTable data={data} count={count} />
    </VStack>
  );
}
