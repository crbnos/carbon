// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useParams } from "react-router";
import { SalesDimensionAssignmentsPanel } from "~/components/SalesDimensionAssignmentsPanel";
import { useRouteData } from "~/hooks";
import { customerValidator } from "~/modules/sales/sales.models";
import { upsertCustomer } from "~/modules/sales/sales.service";
import type { CustomerDetail } from "~/modules/sales/types";
import { CustomerForm } from "~/modules/sales/ui/Customer";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "sales" });
  const customerId = params.customerId;
  if (!customerId) throw new Response("Customer not found", { status: 404 });
  const api = await carbon(request);
  const result = await api.shared.getSalesDimensionAssignments({
    recordType: "customer",
    recordId: customerId
  });
  if (result.error) throw new Error(result.error.message);
  return {
    availableDimensions: result.data?.availableDimensions ?? [],
    assignments: result.data?.assignments ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(customerValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;

  if (!id) {
    throw redirect(
      path.to.customers,
      await flash(request, error(null, "Failed to update customer"))
    );
  }

  const update = await upsertCustomer(client, {
    id,
    ...d,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      path.to.customers,
      await flash(request, error(update.error, "Failed to update customer"))
    );
  }

  return data(null, await flash(request, success("Updated customer")));
}

export default function CustomerEditRoute() {
  const { availableDimensions, assignments } = useLoaderData<typeof loader>();
  const { customerId } = useParams();
  if (!customerId) throw new Error("Could not find customerId");
  const routeData = useRouteData<{ customer: CustomerDetail }>(
    path.to.customer(customerId)
  );

  if (!routeData?.customer) return null;

  const initialValues = {
    ...routeData.customer,
    id: routeData?.customer?.id ?? undefined,
    readableId: routeData?.customer?.readableId ?? undefined,
    name: routeData?.customer?.name ?? "",
    customerTypeId: routeData?.customer?.customerTypeId ?? undefined,
    customerStatusId: routeData?.customer?.customerStatusId ?? undefined,
    accountManagerId: routeData?.customer?.accountManagerId ?? undefined,
    currencyCode: routeData?.customer?.currencyCode ?? undefined,
    taxPercent: routeData?.customer?.taxPercent ?? 0,
    website: routeData?.customer?.website ?? "",
    salesContactId: routeData?.customer?.salesContactId ?? undefined,
    defaultCc: routeData?.customer?.defaultCc ?? [],
    ...getCustomFields(routeData?.customer?.customFields)
  };

  return (
    <div className="min-w-0 space-y-4">
      <CustomerForm key={initialValues.id} initialValues={initialValues} />
      <SalesDimensionAssignmentsPanel
        recordType="customer"
        recordId={customerId}
        availableDimensions={availableDimensions}
        assignments={assignments}
      />
    </div>
  );
}
