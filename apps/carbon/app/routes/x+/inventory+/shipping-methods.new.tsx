import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import type { ShippingCarrier } from "~/modules/inventory";
import {
  ShippingMethodForm,
  shippingMethodValidator,
  upsertShippingMethod,
} from "~/modules/inventory";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(shippingMethodValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertShippingMethod = await upsertShippingMethod(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertShippingMethod.error) {
    return json(
      {},
      await flash(
        request,
        error(insertShippingMethod.error, "Failed to insert shipping method")
      )
    );
  }

  return modal
    ? json(insertShippingMethod, { status: 201 })
    : redirect(
        `${path.to.shippingMethods}?${getParams(request)}`,
        await flash(request, success("Shipping method created"))
      );
}

export default function NewShippingMethodsRoute() {
  const navigate = useNavigate();

  const initialValues = {
    name: "",
    carrier: "" as ShippingCarrier,
  };

  return (
    <ShippingMethodForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
