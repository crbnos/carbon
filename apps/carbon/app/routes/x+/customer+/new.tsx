import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  CustomerForm,
  customerValidator,
  upsertCustomer,
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Customers",
  to: path.to.customers,
  module: "sales",
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(customerValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createCustomer = await upsertCustomer(client, {
    ...data,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId,
  });
  if (createCustomer.error) {
    return modal
      ? json(
          createCustomer,
          await flash(
            request,
            error(createCustomer.error, "Failed to insert customer")
          )
        )
      : redirect(
          path.to.customers,
          await flash(
            request,
            error(createCustomer.error, "Failed to insert customer")
          )
        );
  }

  const customerId = createCustomer.data?.id;

  return modal ? json(createCustomer) : redirect(path.to.customer(customerId));
}

export default function CustomersNewRoute() {
  const initialValues = {
    name: "",
  };
  return (
    <div className="max-w-[50rem] w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <CustomerForm initialValues={initialValues} />
    </div>
  );
}
