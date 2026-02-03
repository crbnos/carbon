import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { customerStatusValidator, upsertCustomerStatus } from "~/modules/sales";
import CustomerStatusForm from "~/modules/sales/ui/CustomerStatuses/CustomerStatusForm";
import { setCustomFields } from "~/utils/form";
import { getParams, path, requestReferrer } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "sales"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(customerStatusValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertCustomerStatus = await upsertCustomerStatus(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertCustomerStatus.error) {
    return modal
      ? insertCustomerStatus
      : redirect(
          requestReferrer(request) ??
            `${path.to.customerStatuses}?${getParams(request)}`,
          await flash(
            request,
            error(
              insertCustomerStatus.error,
              "Failed to insert customer status"
            )
          )
        );
  }

  return modal
    ? insertCustomerStatus
    : redirect(
        `${path.to.customerStatuses}?${getParams(request)}`,
        await flash(request, success("Customer status created"))
      );
}

export default function NewCustomerStatusesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: ""
  };

  return (
    <CustomerStatusForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
