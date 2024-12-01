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
  CustomerLocationForm,
  customerLocationValidator,
  getCustomerLocation,
  updateCustomerLocation,
} from "~/modules/sales";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { customerLocationsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { customerId, customerLocationId } = params;
  if (!customerId) throw notFound("customerId not found");
  if (!customerLocationId) throw notFound("customerLocationId not found");

  const location = await getCustomerLocation(client, customerLocationId);
  if (location.error) {
    throw redirect(
      path.to.customerLocations(customerId),
      await flash(
        request,
        error(location.error, "Failed to get customer location")
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
    update: "sales",
  });

  const { customerId, customerLocationId } = params;
  if (!customerId) throw notFound("customerId not found");
  if (!customerLocationId) throw notFound("customerLocationId not found");

  const formData = await request.formData();
  const validation = await validator(customerLocationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, addressId, name, ...address } = validation.data;

  if (addressId === undefined)
    throw badRequest("addressId is undefined in form data");

  const update = await updateCustomerLocation(client, {
    addressId,
    name,
    address,
    customFields: setCustomFields(formData),
  });
  if (update.error) {
    throw redirect(
      path.to.customerLocations(customerId),
      await flash(
        request,
        error(update.error, "Failed to update customer address")
      )
    );
  }

  throw redirect(
    path.to.customerLocations(customerId),
    await flash(request, success("Customer address updated"))
  );
}

export async function clientAction({
  serverAction,
  params,
}: ClientActionFunctionArgs) {
  const { customerId } = params;
  if (customerId) {
    window.queryClient.setQueryData(
      customerLocationsQuery(customerId).queryKey,
      null
    );
  }
  return await serverAction();
}

export default function EditCustomerLocationRoute() {
  const { location } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

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
    <CustomerLocationForm
      key={initialValues.id}
      customerId={customerId}
      initialValues={initialValues}
      onClose={() => navigate(path.to.customerLocations(customerId))}
    />
  );
}
