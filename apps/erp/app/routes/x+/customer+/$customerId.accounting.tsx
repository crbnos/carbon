import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { CustomerDetail } from "~/modules/sales";
import {
  customerAccountingValidator,
  updateCustomerAccounting,
} from "~/modules/sales";
import CustomerAccountingForm from "~/modules/sales/ui/Customer/CustomerAccountingForm";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "purchasing",
  });
  const formData = await request.formData();
  const validation = await validator(customerAccountingValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  if (!id) {
    throw redirect(
      path.to.customerAccounting(id),
      await flash(request, error(null, "Failed to update customer accounting"))
    );
  }

  const update = await updateCustomerAccounting(client, {
    id,
    ...data,
    updatedBy: userId,
  });

  if (update.error) {
    throw redirect(
      path.to.customerAccounting(id),
      await flash(
        request,
        error(update.error, "Failed to update customer accounting")
      )
    );
  }

  return json(
    null,
    await flash(request, success("Updated customer accounting"))
  );
}

export default function CustomerAccountingRoute() {
  const { customerId } = useParams();
  if (!customerId) throw new Error("Could not find customerId");
  const routeData = useRouteData<{ customer: CustomerDetail }>(
    path.to.customer(customerId)
  );

  if (!routeData?.customer) return null;

  const initialValues = {
    id: routeData?.customer?.id ?? undefined,
    customerTypeId: routeData?.customer?.customerTypeId ?? undefined,
    taxId: routeData?.customer?.taxId ?? "",
  };

  return (
    <CustomerAccountingForm
      key={initialValues.id}
      initialValues={initialValues}
    />
  );
}
