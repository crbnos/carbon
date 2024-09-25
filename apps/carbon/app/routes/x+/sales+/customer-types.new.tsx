import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  CustomerTypeForm,
  customerTypeValidator,
  upsertCustomerType,
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "sales",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(customerTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertCustomerType = await upsertCustomerType(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertCustomerType.error) {
    return modal
      ? json(insertCustomerType)
      : redirect(
          `${path.to.customerTypes}?${getParams(request)}`,
          await flash(
            request,
            error(insertCustomerType.error, "Failed to insert customer type")
          )
        );
  }

  return modal
    ? json(insertCustomerType)
    : redirect(
        `${path.to.customerTypes}?${getParams(request)}`,
        await flash(request, success("Customer type created"))
      );
}

export default function NewCustomerTypesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
  };

  return (
    <CustomerTypeForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
