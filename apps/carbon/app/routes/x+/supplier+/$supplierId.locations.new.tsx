import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useUser } from "~/hooks";
import {
  SupplierLocationForm,
  insertSupplierLocation,
  supplierLocationValidator,
} from "~/modules/purchasing";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { supplierLocationsQuery } from "~/utils/react-query";

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
  const { company } = useUser();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const initialValues = {
    name: "",
    countryCode: company?.countryCode ?? "",
  };

  return (
    <SupplierLocationForm
      initialValues={initialValues}
      supplierId={supplierId}
      onClose={() => navigate(path.to.supplierLocations(supplierId))}
    />
  );
}

export async function clientAction({
  serverAction,
  params,
}: ClientActionFunctionArgs) {
  const { supplierId } = params;
  if (supplierId) {
    window.clientCache?.setQueryData(
      supplierLocationsQuery(supplierId).queryKey,
      null
    );
  }
  return await serverAction();
}
