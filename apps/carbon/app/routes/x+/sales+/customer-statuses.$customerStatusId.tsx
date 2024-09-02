import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  CustomerStatusForm,
  customerStatusValidator,
  getCustomerStatus,
  upsertCustomerStatus,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
    role: "employee",
  });

  const { customerStatusId } = params;
  if (!customerStatusId) throw notFound("customerStatusId not found");

  const customerStatus = await getCustomerStatus(client, customerStatusId);

  if (customerStatus.error) {
    throw redirect(
      path.to.customerStatuses,
      await flash(
        request,
        error(customerStatus.error, "Failed to get customer status")
      )
    );
  }

  return json({
    customerStatus: customerStatus.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const formData = await request.formData();
  const validation = await validator(customerStatusValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateCustomerStatus = await upsertCustomerStatus(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateCustomerStatus.error) {
    return json(
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
    ...getCustomFields(customerStatus.customFields),
  };

  return (
    <CustomerStatusForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
