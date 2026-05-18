import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  customerTypeValidator,
  getCustomerType,
  upsertCustomerType
} from "~/modules/sales";
import { CustomerTypeForm } from "~/modules/sales/ui/CustomerTypes";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { customerTypesQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const { customerTypeId } = params;
  if (!customerTypeId) throw notFound("customerTypeId not found");

  const customerType = await getCustomerType(customerTypeId);

  if (customerType?.data?.protected) {
    throw redirect(
      `${path.to.customerTypes}?${getParams(request)}`,
      await flash(request, error(null, "Cannot edit a protected customer type"))
    );
  }

  return {
    customerType: customerType?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(customerTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateCustomerType = await upsertCustomerType({
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateCustomerType.error) {
    return data(
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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    customerTypesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function EditCustomerTypesRoute() {
  const { customerType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: customerType?.id ?? undefined,
    name: customerType?.name ?? "",
    ...getCustomFields(customerType?.customFields)
  };

  return (
    <CustomerTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
