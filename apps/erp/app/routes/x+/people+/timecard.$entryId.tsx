// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getTimeCardEntry,
  timecardValidator,
  updateTimeCardEntry
} from "~/modules/people";
import { TimecardForm } from "~/modules/people/ui/Timecards";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people"
  });

  const { entryId } = params;
  if (!entryId) throw notFound("Entry ID was not found");

  const entry = await getTimeCardEntry(client, entryId);

  if (entry.error) {
    throw redirect(
      path.to.peopleTimecard,
      await flash(request, error(entry.error, "Failed to get timecard"))
    );
  }

  return {
    entry: entry.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "people"
  });

  const formData = await request.formData();
  const validation = await validator(timecardValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, clockIn, clockOut, note } = validation.data;
  if (!id) throw notFound("Entry ID was not found");

  const result = await updateTimeCardEntry(client, {
    entryId: id,
    clockIn,
    clockOut: clockOut || null,
    note: note || null,
    updatedBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.peopleTimecard,
      await flash(request, error(result.error, "Failed to update timecard"))
    );
  }

  throw redirect(
    path.to.peopleTimecard,
    await flash(request, success("Timecard updated"))
  );
}

export default function TimecardRoute() {
  const { entry } = useLoaderData<typeof loader>();

  const initialValues = {
    id: entry.id,
    employeeId: entry.employeeId,
    clockIn: entry.clockIn,
    clockOut: entry.clockOut ?? "",
    note: entry.note ?? ""
  };

  return <TimecardForm key={initialValues.id} initialValues={initialValues} />;
}
