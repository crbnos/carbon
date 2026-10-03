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
import { dispositionInspectionLot } from "~/services/commands.inspection.server";
import { getDatabaseClient } from "~/services/database.server";
import { inspectionDispositionValidator } from "~/services/models";
import { path } from "~/utils/path";

// One decision surface: the quality verdict carries its physical outcome.
// The work lives in the `dispositionInspectionLot` command
// (`~/services/commands.inspection.server`), which `/api/v1` calls too — so the
// bucket recomputation, the one-shot close and the postings are identical on
// both clients.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  const validation = await validator(inspectionDispositionValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }
  const {
    decision,
    operationId,
    scrapReasonId,
    targetOperationId,
    reworkReason,
    createNcr,
    nonConformanceTypeId,
    setupProductionEventId,
    laborProductionEventId,
    machineProductionEventId
  } = validation.data;
  const returnTo = path.to.inspection(operationId);

  const parseIds = (json: string | undefined): string[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const result = await dispositionInspectionLot(
    {
      serviceRole: await getCarbonServiceRole(),
      client,
      db: getDatabaseClient()
    },
    { companyId, userId },
    {
      inspectionId: id,
      decision,
      operationId,
      scrapEntityIds: parseIds(validation.data.scrapEntityIds),
      reworkEntityIds: parseIds(validation.data.reworkEntityIds),
      scrapQuantity: validation.data.scrapQuantity,
      reworkQuantity: validation.data.reworkQuantity,
      scrapReasonId,
      targetOperationId,
      reworkReason,
      createNcr: createNcr === "true",
      nonConformanceTypeId,
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

  const { message, warnings, finished } = result.data;

  if (warnings.length > 0) {
    throw redirect(
      finished ? path.to.operations : returnTo,
      await flash(
        request,
        error(null, `${message}, but ${warnings.join("; ")}`)
      )
    );
  }

  throw redirect(
    finished ? path.to.operations : returnTo,
    await flash(request, success(message))
  );
}
