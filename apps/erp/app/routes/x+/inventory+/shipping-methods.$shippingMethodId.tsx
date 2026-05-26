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
import type { ShippingCarrier } from "~/modules/inventory";
import {
  ShippingMethodForm,
  shippingMethodValidator
} from "~/modules/inventory";
import {
  getShippingMethod,
  upsertShippingMethod
} from "~/modules/inventory/inventory.service.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, shippingMethodsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const { shippingMethodId } = params;
  if (!shippingMethodId) throw notFound("shippingMethodId not found");

  const shippingMethod = await getShippingMethod(shippingMethodId);

  return {
    shippingMethod: shippingMethod?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(shippingMethodValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateShippingMethod = await upsertShippingMethod({
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateShippingMethod.error) {
    return data(
      {},
      await flash(
        request,
        error(updateShippingMethod.error, "Failed to update shipping method")
      )
    );
  }

  throw redirect(
    `${path.to.shippingMethods}?${getParams(request)}`,
    await flash(request, success("Updated shipping method"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    shippingMethodsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function EditShippingMethodsRoute() {
  const { shippingMethod } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: shippingMethod?.id ?? undefined,
    name: shippingMethod?.name ?? "",
    carrier: (shippingMethod?.carrier ?? "") as ShippingCarrier,
    carrierAccountId: shippingMethod?.carrierAccountId ?? "",
    trackingUrl: shippingMethod?.trackingUrl ?? "",
    ...getCustomFields(shippingMethod?.customFields)
  };

  return (
    <ShippingMethodForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
