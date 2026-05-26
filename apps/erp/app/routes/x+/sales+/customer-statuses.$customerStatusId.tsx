import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { customerStatusValidator } from "~/modules/sales";
import {
  getCustomerStatus,
  upsertCustomerStatus
} from "~/modules/sales/sales.service.server";
import CustomerStatusForm from "~/modules/sales/ui/CustomerStatuses/CustomerStatusForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const { customerStatusId } = params;
  if (!customerStatusId) throw notFound("customerStatusId not found");

  const customerStatus = await getCustomerStatus(customerStatusId);

  if (customerStatus.error) {
    throw redirect(
      path.to.customerStatuses,
      await flash(
        request,
        error(customerStatus.error, "Failed to get customer status")
      )
    );
  }

  return {
    customerStatus: customerStatus.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(customerStatusValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateCustomerStatus = await upsertCustomerStatus({
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateCustomerStatus.error) {
    return data(
      {},
      await flash(
        request,
        error(updateCustomerStatus.error, "Failed to update customer status")
      )
    );
  }

  throw redirect(
    path.to.customerStatuses,
    await flash(request, success("Updated customer status"))
  );
}

export default function EditCustomerStatusesRoute() {
  const { customerStatus } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: customerStatus.id ?? undefined,
    name: customerStatus.name ?? "",
    ...getCustomFields(customerStatus.customFields)
  };

  return (
    <CustomerStatusForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
