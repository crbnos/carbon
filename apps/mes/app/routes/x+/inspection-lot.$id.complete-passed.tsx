// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { completePassedInspectionUnits } from "~/services/commands.inspection.server";
import { getDatabaseClient } from "~/services/database.server";
import { inspectionCompletePassedValidator } from "~/services/models";
import { path } from "~/utils/path";

// Progressive completion while the lot stays open — the work is in the
// `completePassedInspectionUnits` command, which `/api/v1` calls too.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  const validation = await validator(
    inspectionCompletePassedValidator
  ).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }
  const {
    operationId,
    setupProductionEventId,
    laborProductionEventId,
    machineProductionEventId
  } = validation.data;
  const returnTo = path.to.inspection(operationId);

  const result = await completePassedInspectionUnits(
    {
      serviceRole: await getCarbonServiceRole(),
      client,
      db: getDatabaseClient()
    },
    { companyId, userId },
    {
      inspectionId: id,
      operationId,
      eventIds: {
        setupProductionEventId,
        laborProductionEventId,
        machineProductionEventId
      }
    }
  );

  if (!result.ok) {
    const { failure } = result;
    throw redirect(
      returnTo,
      await flash(request, error(failure.details ?? null, failure.message))
    );
  }

  const { completed } = result.data;

  throw redirect(
    returnTo,
    await flash(
      request,
      success(`${completed} unit${completed === 1 ? "" : "s"} completed`)
    )
  );
}
