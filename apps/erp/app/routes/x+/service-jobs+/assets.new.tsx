// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { customerAssetValidator } from "~/modules/service/service.models";
import { CustomerAssetForm } from "~/modules/service/ui/CustomerAssets";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "service"
  });

  const customerId = new URL(request.url).searchParams.get("customerId");
  return { customerId };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(customerAssetValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
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
  const closeRoute = useCloseRoute();

  return (
    <CustomerAssetForm
      initialValues={{
        itemId: "",
        serialNumber: "",
        customerId: customerId ?? ""
      }}
      onClose={() => closeRoute()}
    />
  );
}
