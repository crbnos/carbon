import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useNavigate, useParams } from "@remix-run/react";
import {
  SupplierLocationForm,
  insertSupplierLocation,
  supplierLocationValidator,
} from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "purchasing",
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

  const { id, addressId, name, ...address } = validation.data;

  const createSupplierLocation = await insertSupplierLocation(client, {
    supplierId,
    companyId,
    name,
    address,
    customFields: setCustomFields(formData),
  });
  if (createSupplierLocation.error) {
    return modal
      ? json(createSupplierLocation)
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
    ? json(createSupplierLocation, { status: 201 })
    : redirect(
        path.to.supplierLocations(supplierId),
        await flash(request, success("Supplier location created"))
      );
}

export default function SupplierLocationsNewRoute() {
  const navigate = useNavigate();

  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const initialValues = {
    name: "", // Ask Brad how to avoid this janky solution
  };

  return (
    <SupplierLocationForm
      initialValues={initialValues}
      supplierId={supplierId}
      onClose={() => navigate(path.to.supplierLocations(supplierId))}
    />
  );
}
