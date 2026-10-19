// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { shippingMethodValidator } from "~/modules/inventory/inventory.models";
import { getShippingMethod } from "~/modules/inventory/inventory.service";
import type { ShippingCarrier } from "~/modules/inventory/types";
import { ShippingMethodForm } from "~/modules/inventory/ui";
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(shippingMethodValidator).request(args, {
    params: ["shippingMethodId"]
  });
  if ("invalid" in input) return input.invalid;
  const { id: _, ...shippingMethod } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.updateShippingMethod({
    ...shippingMethod,
    id: input.params.shippingMethodId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // An error is toasted and the drawer stays open.
  if (result.error) return result;
  return respond(args.request, result).redirect(
    `${path.to.shippingMethods}?${getParams(args.request)}`,
    { message: "Updated shipping method" }
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
