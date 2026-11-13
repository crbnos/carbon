// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { authorize } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { customerAssetValidator } from "~/modules/service/service.models";
import { CustomerAssetForm } from "~/modules/service/ui/CustomerAssets";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await authorize(request, { "service.customerAssets": "Create" });

  const customerId = new URL(request.url).searchParams.get("customerId");
  return { customerId };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(customerAssetValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request, {
    "service.customerAssets": "Create"
  });
  const result = await api.service.registerCustomerAsset(input.data);
  if (result.error?.category === "rule") {
    return validationError({
      fieldErrors: { serialNumber: result.error.message }
    });
  }
  if (!result.data) {
    return respond(args.request, result).redirect(path.to.customerAssets);
  }
  return respond(args.request, result).redirect(
    path.to.customerAsset(result.data.id),
    { message: "Customer asset registered" }
  );
}

export default function NewCustomerAssetRoute() {
  const { customerId } = useLoaderData<typeof loader>();
  const dialog = useRouteDialog();

  return (
    <CustomerAssetForm
      initialValues={{
        itemId: "",
        serialNumber: "",
        customerId: customerId ?? ""
      }}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
