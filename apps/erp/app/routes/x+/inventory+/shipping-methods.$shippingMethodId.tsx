// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import type { ShippingCarrier } from "~/modules/inventory";
import {
  getShippingMethod,
  ShippingMethodForm,
  shippingMethodValidator,
  upsertShippingMethod
} from "~/modules/inventory";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const { shippingMethodId } = params;
  if (!shippingMethodId) throw notFound("shippingMethodId not found");

  const shippingMethod = await getShippingMethod(client, shippingMethodId);

  return {
    shippingMethod: shippingMethod?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
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

  const updateShippingMethod = await upsertShippingMethod(client, {
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

export default function EditShippingMethodsRoute() {
  const { shippingMethod } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

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
      onClose={() => closeRoute()}
    />
  );
}
