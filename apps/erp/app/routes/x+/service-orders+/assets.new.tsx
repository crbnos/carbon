// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { customerAssetValidator } from "~/modules/service/service.models";
import {
  registerCustomerAsset,
  ServiceOrderError
} from "~/modules/service/service.server";
import { CustomerAssetForm } from "~/modules/service/ui/CustomerAssets";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "service"
  });

  const customerId = new URL(request.url).searchParams.get("customerId");
  return { customerId };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "service"
  });

  const formData = await request.formData();
  const validation = await validator(customerAssetValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  try {
    const asset = await registerCustomerAsset(getDatabaseClient(), {
      ...validation.data,
      companyId,
      userId
    });
    throw redirect(
      path.to.customerAsset(asset.id),
      await flash(request, success("Customer asset registered"))
    );
  } catch (err) {
    if (err instanceof Response) throw err;
    if (err instanceof ServiceOrderError) {
      return validationError({
        fieldErrors: { serialNumber: err.message }
      });
    }
    throw redirect(
      path.to.customerAssets,
      await flash(request, error(err, "Failed to register the customer asset"))
    );
  }
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
