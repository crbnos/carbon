// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data } from "react-router";
import type { ShippingCarrier } from "~/modules/inventory";
import {
  ShippingMethodForm,
  shippingMethodValidator,
  upsertShippingMethod
} from "~/modules/inventory";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, shippingMethodsQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(shippingMethodValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const insertShippingMethod = await upsertShippingMethod(client, {
    ...rest,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertShippingMethod.error) {
    return data(
      {},
      await flash(
        request,
        error(insertShippingMethod.error, "Failed to insert shipping method")
      )
    );
  }

  return modal
    ? data(insertShippingMethod, { status: 201 })
    : redirect(
        `${path.to.shippingMethods}?${getParams(request)}`,
        await flash(request, success("Shipping method created"))
      );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    shippingMethodsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
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
