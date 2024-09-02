import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  CustomerPaymentForm,
  customerPaymentValidator,
  getCustomerPayment,
  updateCustomerPayment,
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

  const customerPayment = await getCustomerPayment(client, customerId);

  if (customerPayment.error || !customerPayment.data) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(customerPayment.error, "Failed to load customer payment")
      )
    );
  }

  return json({
    customerPayment: customerPayment.data,
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
  const validation = await validator(customerPaymentValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateCustomerPayment(client, {
    ...validation.data,
    customerId,
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(update.error, "Failed to update customer payment")
      )
    );
  }

  throw redirect(
    path.to.customerPayment(customerId),
    await flash(request, success("Updated customer payment"))
  );
}

export default function CustomerPaymentRoute() {
  const { customerPayment } = useLoaderData<typeof loader>();
  const initialValues = {
    customerId: customerPayment?.customerId ?? "",
    invoiceCustomerId: customerPayment?.invoiceCustomerId ?? "",
    invoiceCustomerContactId: customerPayment?.invoiceCustomerContactId ?? "",
    invoiceCustomerLocationId: customerPayment?.invoiceCustomerLocationId ?? "",
    paymentTermId: customerPayment?.paymentTermId ?? "",
    currencyCode: customerPayment?.currencyCode ?? "",
  };

  return <CustomerPaymentForm initialValues={initialValues} />;
}
