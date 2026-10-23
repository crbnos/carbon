// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import { serviceJobDayHoursValidator } from "~/modules/service/service.models";

/**
 * Sets the signed-in user's hours on a service job for one day, from a My
 * Time service row (`setServiceJobDayHours`). Answers `{ error }`, which the
 * bar reads: a refusal reverts the bar and toasts. A total below the day's
 * clock time is not saved and comes back as `warning`.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const validation = await validator(serviceJobDayHoursValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    const message =
      Object.values(validation.error.fieldErrors)[0] ?? "The hours are invalid";
    return data({ error: { message } }, { status: 400 });
  }

  const api = await carbon(request);
  const result = await api.service.setServiceJobDayHours(validation.data);
  if (result.error) {
    return data({ error: { message: result.error.message } }, { status: 400 });
  }

  const { warning, saved } = result.data;
  return data({ error: null, data: { saved }, warning });
}
