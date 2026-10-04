// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteHoliday, getHoliday } from "~/modules/people";
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
  const { client } = await requirePermissions(request, {
    delete: "people"
  });

  const { holidayId } = params;
  if (!holidayId) {
    throw redirect(
      path.to.holidays,
      await flash(request, error(params, "Failed to get holiday id"))
    );
  }

  const { error: deleteHolidayError } = await deleteHoliday(client, holidayId);
  if (deleteHolidayError) {
    throw redirect(
      path.to.holidays,
      await flash(
        request,
        error(deleteHolidayError, "Failed to delete holiday")
      )
    );
  }

  throw redirect(
    path.to.holidays,
    await flash(request, success("Successfully deleted holiday"))
  );
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
