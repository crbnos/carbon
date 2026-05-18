import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { useUser } from "~/hooks";
import { customerValidator, upsertCustomer } from "~/modules/sales";
import { CustomerForm } from "~/modules/sales/ui/Customer";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Customers`,
  to: path.to.customers,
  module: "sales"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(customerValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const createCustomer = await upsertCustomer({
    ...rest,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId
  });
  if (createCustomer.error) {
    return modal
      ? data(
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

  return modal ? createCustomer : redirect(path.to.customer(customerId));
}

export default function CustomersNewRoute() {
  const { company } = useUser();

  const initialValues = {
    name: "",
    currencyCode: company?.baseCurrencyCode ?? undefined,
    phone: "",
    fax: "",
    website: "",
    taxPercent: 0
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <CustomerForm initialValues={initialValues} />
    </div>
  );
}
