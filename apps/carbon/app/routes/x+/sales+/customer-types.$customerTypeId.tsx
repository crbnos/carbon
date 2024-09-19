import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  CustomerTypeForm,
  customerTypeValidator,
  getCustomerType,
  upsertCustomerType,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
    role: "employee",
  });

  const { customerTypeId } = params;
  if (!customerTypeId) throw notFound("customerTypeId not found");

  const customerType = await getCustomerType(client, customerTypeId);

  if (customerType?.data?.protected) {
    throw redirect(
      `${path.to.customerTypes}?${getParams(request)}`,
      await flash(request, error(null, "Cannot edit a protected customer type"))
    );
  }

  return json({
    customerType: customerType?.data ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const formData = await request.formData();
  const validation = await validator(customerTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateCustomerType = await upsertCustomerType(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateCustomerType.error) {
    return json(
      {},
      await flash(
        request,
        error(updateCustomerType.error, "Failed to update customer type")
      )
    );
  }

  throw redirect(
    `${path.to.customerTypes}?${getParams(request)}`,
    await flash(request, success("Updated customer type"))
  );
}

export default function EditCustomerTypesRoute() {
  const { customerType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: customerType?.id ?? undefined,
    name: customerType?.name ?? "",
    ...getCustomFields(customerType?.customFields),
  };

  return (
    <CustomerTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
