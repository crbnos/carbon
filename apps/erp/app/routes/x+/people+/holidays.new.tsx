// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { holidayValidator } from "~/modules/people/people.models";
import { HolidayForm } from "~/modules/people/ui/Holidays";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(holidayValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _id, ...holiday } = input.data;
  const api = await carbon(args.request);
  const result = await api.people.createHoliday({
    ...holiday,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(path.to.holidays, {
    message: "Holiday created"
  });
}

export default function NewHolidayRoute() {
  const initialValues = {
    name: "",
    date: ""
  };

  return <HolidayForm initialValues={initialValues} />;
}
