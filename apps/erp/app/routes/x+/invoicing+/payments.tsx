import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getPayments, PaymentsTable } from "~/modules/invoicing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Payments",
  to: path.to.payments,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const search = searchParams.get("search");
  const paymentType = searchParams.get("paymentType") as
    | "Receipt"
    | "Disbursement"
    | null;
  const status = searchParams.get("status") as
    | "Draft"
    | "Posted"
    | "Voided"
    | null;
  const customerId = searchParams.get("customerId");
  const supplierId = searchParams.get("supplierId");

  const {
    limit,
    offset,
    sorts,
    filters = []
  } = getGenericQueryFilters(searchParams);

  // The "Counterparty" column filter spans two columns (customerId OR
  // supplierId), so pull it out of the generic filters and hand it to
  // getPayments, which applies it as an OR. The rest pass through normally.
  const counterpartyIds = filters
    .filter((f) => f.column === "counterparty")
    .flatMap((f) => (f.value ?? "").split(","))
    .filter(Boolean);
  const passThroughFilters = filters.filter((f) => f.column !== "counterparty");

  const payments = await getPayments(client, companyId, {
    search,
    paymentType,
    status,
    customerId,
    supplierId,
    counterpartyIds: counterpartyIds.length > 0 ? counterpartyIds : null,
    limit,
    offset,
    sorts,
    filters: passThroughFilters
  });

  if (payments.error) {
    throw redirect(
      path.to.invoicing,
      await flash(request, error(payments.error, "Failed to fetch payments"))
    );
  }

  return {
    count: payments.count ?? 0,
    payments: payments.data ?? []
  };
}

export default function PaymentsRoute() {
  const { count, payments } = useLoaderData<typeof loader>();
  return <PaymentsTable data={payments} count={count} />;
}
