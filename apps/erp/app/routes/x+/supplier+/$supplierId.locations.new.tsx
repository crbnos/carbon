// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data, useParams } from "react-router";
import { useUser } from "~/hooks";
import { supplierLocationValidator } from "~/modules/purchasing/purchasing.models";
import { insertSupplierLocation } from "~/modules/purchasing/purchasing.service";
import SupplierLocationForm from "~/modules/purchasing/ui/Supplier/SupplierLocationForm";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const { supplierId } = params;
  if (!supplierId) throw notFound("supplierId not found");

  const validation = await validator(supplierLocationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, addressId, name, ...address } = validation.data;

  const createSupplierLocation = await insertSupplierLocation(client, {
    supplierId,
    companyId,
    name,
    address,
    customFields: setCustomFields(formData)
  });
  if (createSupplierLocation.error) {
    return modal
      ? createSupplierLocation
      : redirect(
          path.to.supplierLocations(supplierId),
          await flash(
            request,
            error(
              createSupplierLocation.error,
              "Failed to create supplier location"
            )
          )
        );
  }

  return modal
    ? data(createSupplierLocation, { status: 201 })
    : redirect(
        path.to.supplierLocations(supplierId),
        await flash(request, success("Supplier location created"))
      );
}

export default function SupplierLocationsNewRoute() {
  const { company } = useUser();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");
  const dialog = useRouteDialog(path.to.supplierLocations(supplierId));

  const initialValues = {
    name: "",
    countryCode: company?.countryCode ?? ""
  };

  return (
    <SupplierLocationForm
      initialValues={initialValues}
      supplierId={supplierId}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
