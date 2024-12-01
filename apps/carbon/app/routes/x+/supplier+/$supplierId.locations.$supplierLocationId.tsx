import {
  assertIsPost,
  badRequest,
  error,
  notFound,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  SupplierLocationForm,
  getSupplierLocation,
  supplierLocationValidator,
  updateSupplierLocation,
} from "~/modules/purchasing";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { supplierLocationsQuery } from "~/utils/react-query";

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

export async function clientAction({
  serverAction,
  params,
}: ClientActionFunctionArgs) {
  const { supplierId } = params;
  if (supplierId) {
    window.queryClient.setQueryData(
      supplierLocationsQuery(supplierId).queryKey,
      null
    );
  }
  return await serverAction();
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
    stateProvince: location?.address?.stateProvince ?? "",
    postalCode: location?.address?.postalCode ?? "",
    countryCode: location?.address?.country?.alpha2 ?? "",
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
