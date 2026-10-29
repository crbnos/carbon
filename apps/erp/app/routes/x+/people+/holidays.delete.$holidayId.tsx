// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { getHoliday } from "~/modules/people/people.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people",
    role: "employee"
  });

  const { holidayId } = params;
  if (!holidayId) throw notFound("holidayId not found");

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

export async function action({ request, params }: ActionFunctionArgs) {
  const { holidayId } = params;
  if (!holidayId) throw notFound("Holiday ID was not found");
  const api = await carbon(request);
  const result = await api.people.deleteHoliday({ holidayId });
  return respond(request, result).redirect(path.to.holidays, {
    message: "Successfully deleted holiday"
  });
}

export default function DeleteHolidayRoute() {
  const { holidayId } = useParams();
  const { holiday } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!holiday) return null;
  if (!holidayId) throw new Error("holidayId is not found");

  const onCancel = () => navigate(path.to.holidays);
  const name = holiday.name;
  return (
    <ConfirmDelete
      action={path.to.deleteHoliday(holidayId)}
      name={name}
      text={t`Are you sure you want to delete the holiday: ${name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
