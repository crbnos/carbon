import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import type { ShippingCarrier } from "~/modules/inventory";
import {
  ShippingMethodForm,
  shippingMethodValidator,
  upsertShippingMethod,
} from "~/modules/inventory";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

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
  const initialValues = {
    name: "",
    carrier: "" as ShippingCarrier,
  };

  return <ShippingMethodForm initialValues={initialValues} />;
}
