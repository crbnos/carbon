import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { CustomerDetail } from "~/modules/sales";
import { customerValidator, upsertCustomer } from "~/modules/sales";
import { CustomerForm } from "~/modules/sales/ui/Customer";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

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
  const { customerId } = useParams();
  if (!customerId) throw new Error("Could not find customerId");
  const routeData = useRouteData<{ customer: CustomerDetail }>(
    path.to.customer(customerId)
  );

  if (!routeData?.customer) return null;

  const initialValues = {
    ...routeData.customer,
    id: routeData?.customer?.id ?? undefined,
    name: routeData?.customer?.name ?? "",
    customerTypeId: routeData?.customer?.customerTypeId ?? undefined,
    customerStatusId: routeData?.customer?.customerStatusId ?? undefined,
    accountManagerId: routeData?.customer?.accountManagerId ?? undefined,
    taxId: routeData?.customer?.taxId ?? "",
    currencyCode: routeData?.customer?.currencyCode ?? undefined,
    taxPercent: routeData?.customer?.taxPercent ?? 0,
    website: routeData?.customer?.website ?? "",
    salesContactId: routeData?.customer?.salesContactId ?? undefined,
    invoicingContactId: routeData?.customer?.invoicingContactId ?? undefined,
    defaultCc: routeData?.customer?.defaultCc ?? [],
    ...getCustomFields(routeData?.customer?.customFields)
  };

  return <CustomerForm key={initialValues.id} initialValues={initialValues} />;
}
