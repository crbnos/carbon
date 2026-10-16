// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { getLocalTimeZone } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate } from "react-router";
import { useUser } from "~/hooks";
import { locationValidator } from "~/modules/resources/resources.models";
import { LocationForm } from "~/modules/resources/ui";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(locationValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.createLocation({
    ...input.data,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // The modal form reads the result and closes itself.
  if (input.formData?.get("type") === "modal") return result;
  return respond(args.request, result).redirect(path.to.locations, {
    message: "Location created"
  });
}

export default function NewLocationRoute() {
  const navigate = useNavigate();
  const { company } = useUser();
  const onClose = () => navigate(path.to.locations);

  const initialValues = {
    name: "",
    timezone: getLocalTimeZone(),
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateProvince: "",
    postalCode: "",
    countryCode: company?.countryCode ?? ""
  };

  return <LocationForm initialValues={initialValues} onClose={onClose} />;
}
