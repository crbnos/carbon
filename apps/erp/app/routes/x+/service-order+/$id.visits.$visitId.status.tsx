// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, hasPermission, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getUserClaims } from "@carbon/auth/users.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import type { ServiceVisitStatus } from "~/modules/service";
import { serviceVisitStatusValidator } from "~/modules/service";
import {
  ServiceOrderError,
  setServiceVisitStatus
} from "~/modules/service/service.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "service-visit-status");

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
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    view: "service"
  });
  const { id, visitId } = params;
  if (!id) throw new Error("Could not find id");
  if (!visitId) throw new Error("Could not find visitId");

  const validation = await validator(serviceVisitStatusValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return data({ success: false, error: { message: "Choose a status" } });
  }

  const canUpdateAny = hasPermission(
    (await getUserClaims(userId, companyId))?.permissions,
    "service",
    "update",
    companyId
  );

  try {
    await setServiceVisitStatus(getDatabaseClient(), {
      companyId,
      userId,
      serviceOrderId: id,
      serviceVisitId: visitId,
      status: validation.data.status,
      workComplete: validation.data.workComplete,
      technicianId: canUpdateAny ? undefined : userId
    });
  } catch (err) {
    if (err instanceof ServiceOrderError) {
      return data({ success: false, error: { message: err.message } });
    }
    logger.error("Failed to update the visit", {
      companyId,
      serviceOrderId: id,
      serviceVisitId: visitId,
      error: err
    });
    return data({
      success: false,
      error: { message: "Failed to update the visit" }
    });
  }

  return data(
    { success: true, error: null },
    await flash(request, success(MESSAGES[validation.data.status]))
  );
}
