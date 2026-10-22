// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import type { ServiceVisitStatus } from "~/modules/service/service.models";
import { serviceVisitStatusValidator } from "~/modules/service/service.models";

const MESSAGES: Record<ServiceVisitStatus, string> = {
  Scheduled: "Visit scheduled",
  Traveling: "Travel started",
  "On Site": "Arrived on site",
  Completed: "Visit completed",
  Cancelled: "Visit cancelled"
};

/**
 * Moves a visit to its next status and stamps the time, then rolls the
 * order's status up. A user who may update service moves any visit; any
 * other service user moves only a visit they are the technician on.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["id", "visitId"]
  });
  if ("invalid" in input) return input.invalid;
  const validation = await validator(serviceVisitStatusValidator).validate(
    await args.request.formData()
  );
  if (validation.error) {
    return data({ success: false, error: { message: "Choose a status" } });
  }

  const api = await carbon(args.request);
  const result = await api.service.setServiceVisitStatus({
    serviceOrderId: input.params.id,
    serviceVisitId: input.params.visitId,
    status: validation.data.status,
    workComplete: validation.data.workComplete
  });
  if (result.error) {
    return data({ success: false, error: { message: result.error.message } });
  }

  return data(
    { success: true, error: null },
    await flash(args.request, success(MESSAGES[validation.data.status]))
  );
}
