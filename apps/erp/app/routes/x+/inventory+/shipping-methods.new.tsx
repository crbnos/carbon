// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { shippingMethodValidator } from "~/modules/inventory/inventory.models";
import type { ShippingCarrier } from "~/modules/inventory/types";
import { ShippingMethodForm } from "~/modules/inventory/ui";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(shippingMethodValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _, ...shippingMethod } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.createShippingMethod({
    ...shippingMethod,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // A modal reads the new method; an error is toasted and the form stays open.
  if (result.error || input.formData?.get("type") === "modal") return result;
  return respond(args.request, result).redirect(
    `${path.to.shippingMethods}?${getParams(args.request)}`,
    { message: "Shipping method created" }
  );
}

export default function NewShippingMethodsRoute() {
  const closeRoute = useCloseRoute();

  const initialValues = {
    name: "",
    carrier: "" as ShippingCarrier
  };

  return (
    <ShippingMethodForm
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
