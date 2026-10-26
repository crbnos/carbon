// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { holidayValidator } from "~/modules/people/people.models";
import { getHoliday } from "~/modules/people/people.service";
import { HolidayForm } from "~/modules/people/ui/Holidays";
import { getCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people"
  });

  const { holidayId } = params;
  if (!holidayId) throw notFound("Holiday ID was not found");

  const holiday = await getHoliday(client, holidayId);

  if (holiday.error) {
    throw redirect(
      path.to.holidays,
      await flash(request, error(holiday.error, "Failed to get holiday"))
    );
  }

  return {
    holiday: holiday.data
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(holidayValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id, name, date } = input.data;
  if (!id) throw notFound("Holiday ID was not found");
  const api = await carbon(args.request);
  const result = await api.people.updateHoliday({ id, name, date });
  return respond(args.request, result).redirect(path.to.holidays, {
    message: "Holiday updated"
  });
}

export default function HolidayRoute() {
  const { holiday } = useLoaderData<typeof loader>();

  const initialValues = {
    id: holiday.id,
    name: holiday.name,
    date: holiday.date,
    ...getCustomFields(holiday.customFields)
  };

  return <HolidayForm key={initialValues.id} initialValues={initialValues} />;
}
