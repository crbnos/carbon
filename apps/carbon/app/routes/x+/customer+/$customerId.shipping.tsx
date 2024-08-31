import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  CustomerShippingForm,
  customerShippingValidator,
  getCustomerShipping,
  updateCustomerShipping,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const customerShipping = await getCustomerShipping(client, customerId);

  if (customerShipping.error || !customerShipping.data) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(customerShipping.error, "Failed to load customer shipping")
      )
    );
  }

  return json({
    customerShipping: customerShipping.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  // validate with salesValidator
  const validation = await validator(customerShippingValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateCustomerShipping(client, {
    ...validation.data,
    customerId,
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(update.error, "Failed to update customer shipping")
      )
    );
  }

  throw redirect(
    path.to.customerShipping(customerId),
    await flash(request, success("Updated customer shipping"))
  );
}

export default function CustomerShippingRoute() {
  const { customerShipping } = useLoaderData<typeof loader>();
  const initialValues = {
    customerId: customerShipping?.customerId ?? "",
    shippingCustomerId: customerShipping?.shippingCustomerId ?? "",
    shippingCustomerContactId:
      customerShipping?.shippingCustomerContactId ?? "",
    shippingCustomerLocationId:
      customerShipping?.shippingCustomerLocationId ?? "",
    shippingMethodId: customerShipping?.shippingMethodId ?? "",
    // shippingTermId: customerShipping?.shippingTermId ?? "",
  };

  return (
    <CustomerShippingForm
      key={initialValues.customerId}
      initialValues={initialValues}
    />
  );
}
