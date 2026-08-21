import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone } from "@internationalized/date";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  getLocation,
  LocationForm,
  locationValidator,
  upsertLocation
} from "~/modules/resources";
import { invalidateLocationTimeZone } from "~/modules/shared/timezone.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { getCompanyId, locationsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources"
  });

  const { locationId } = params;
  if (!locationId) throw notFound("Location ID was not found");

  const location = await getLocation(client, locationId);

  if (location.error) {
    throw redirect(
      path.to.locations,
      await flash(request, error(location.error, "Failed to get location"))
    );
  }

  return {
    location: location.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(locationValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw notFound("Location ID was not found");

  const createLocation = await upsertLocation(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createLocation.error) {
    throw redirect(
      path.to.locations,
      await flash(
        request,
        error(createLocation.error, "Failed to create location.")
      )
    );
  }

  // location.timezone may have changed — drop the cached resolution.
  await invalidateLocationTimeZone(id, companyId);

  throw redirect(
    path.to.locations,
    await flash(request, success("Location updated"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    locationsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function LocationRoute() {
  const { location } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const initialValues = {
    id: location.id,
    name: location.name,
    code: location.code ?? undefined,
    addressLine1: location.addressLine1 ?? undefined,
    addressLine2: location.addressLine2 ?? undefined,
    city: location.city ?? undefined,
    stateProvince: location.stateProvince ?? undefined,
    postalCode: location.postalCode ?? undefined,
    countryCode: location.countryCode ?? "",
    timezone: location.timezone ?? getLocalTimeZone(),
    latitude: location.latitude ?? undefined,
    longitude: location.longitude ?? undefined,
    ...getCustomFields(location.customFields)
  };

  return <LocationForm initialValues={initialValues} onClose={onClose} />;
}
