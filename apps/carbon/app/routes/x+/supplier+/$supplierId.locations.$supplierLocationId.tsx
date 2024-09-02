import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import {
  SupplierLocationForm,
  getSupplierLocation,
  supplierLocationValidator,
  updateSupplierLocation,
} from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, badRequest, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { supplierId, supplierLocationId } = params;
  if (!supplierId) throw notFound("supplierId not found");
  if (!supplierLocationId) throw notFound("supplierLocationId not found");

  const location = await getSupplierLocation(client, supplierLocationId);
  if (location.error) {
    throw redirect(
      path.to.supplierLocations(supplierId),
      await flash(
        request,
        error(location.error, "Failed to get supplier location")
      )
    );
  }

  return json({
    location: location.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "purchasing",
  });

  const { supplierId, supplierLocationId } = params;
  if (!supplierId) throw notFound("supplierId not found");
  if (!supplierLocationId) throw notFound("supplierLocationId not found");

  const formData = await request.formData();
  const validation = await validator(supplierLocationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, addressId, name, ...address } = validation.data;

  if (addressId === undefined)
    throw badRequest("addressId is undefined in form data");

  const update = await updateSupplierLocation(client, {
    addressId,
    name,
    address,
    customFields: setCustomFields(formData),
  });
  if (update.error) {
    throw redirect(
      path.to.supplierLocations(supplierId),
      await flash(
        request,
        error(update.error, "Failed to update supplier address")
      )
    );
  }

  throw redirect(
    path.to.supplierLocations(supplierId),
    await flash(request, success("Supplier address updated"))
  );
}

export default function EditSupplierLocationRoute() {
  const { location } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const initialValues = {
    id: location?.id ?? undefined,
    addressId: location?.address?.id ?? undefined,
    name: location?.name ?? undefined,

    addressLine1: location?.address?.addressLine1 ?? "",
    addressLine2: location?.address?.addressLine2 ?? "",
    city: location?.address?.city ?? "",
    state: location?.address?.state ?? "",
    postalCode: location?.address?.postalCode ?? "",
    ...getCustomFields(location?.customFields),
  };

  return (
    <SupplierLocationForm
      key={initialValues.id}
      supplierId={supplierId}
      initialValues={initialValues}
      onClose={() => navigate(path.to.supplierLocations(supplierId))}
    />
  );
}
