// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createTimeCardEntry, timecardValidator } from "~/modules/people";
import { TimecardForm } from "~/modules/people/ui/Timecards";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "people"
  });

  const formData = await request.formData();
  const validation = await validator(timecardValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...data } = validation.data;

  const result = await createTimeCardEntry(client, {
    employeeId: data.employeeId,
    companyId,
    clockIn: data.clockIn,
    clockOut: data.clockOut || null,
    note: data.note || null,
    createdBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.peopleTimecard,
      await flash(request, error(result.error, "Failed to create timecard"))
    );
  }

  throw redirect(
    path.to.peopleTimecard,
    await flash(request, success("Timecard created"))
  );
}

export default function NewTimecardRoute() {
  const initialValues = {
    employeeId: "",
    clockIn: "",
    clockOut: "",
    note: ""
  };

  return <TimecardForm initialValues={initialValues} />;
}
