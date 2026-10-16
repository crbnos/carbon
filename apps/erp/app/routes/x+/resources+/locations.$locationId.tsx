// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { getLocalTimeZone } from "@internationalized/date";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { carbon, respond } from "~/modules/carbon.server";
import {
  getLocation,
  LocationForm,
  locationValidator
} from "~/modules/resources";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(locationValidator).request(args, {
    params: ["locationId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.location.update({
    ...input.data,
    id: input.params.locationId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(
    path.to.locations,
    "Location updated"
  );
}

export default function LocationRoute() {
  const { location } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  const onClose = () => closeRoute();

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
