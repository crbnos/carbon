// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { upsertInspectionMeasurement } from "@carbon/database/quality";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { inspectionMeasurementValidator } from "~/services/models";
import { abilityBlockRefusal } from "~/services/operations.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  const validation = await validator(inspectionMeasurementValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  if (validation.data.inspectionId !== id) {
    return data(
      { error: { message: "Inspection id mismatch" } },
      await flash(request, error(null, "Inspection id mismatch"))
    );
  }

  const db = getDatabaseClient();

  // A job-operation lot carries its operation as sourceDocumentLineId;
  // receipt lots have no operation to gate.
  const lot = await db
    .selectFrom("inspection")
    .select(["sourceDocument", "sourceDocumentLineId"])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const refusal =
    lot?.sourceDocument === "Job Operation" && lot.sourceDocumentLineId
      ? await abilityBlockRefusal(await getCarbonServiceRole(), {
          operationId: lot.sourceDocumentLineId,
          employeeId: userId,
          companyId
        })
      : null;
  if (refusal) {
    return data(
      { error: { message: refusal } },
      await flash(request, error(null, refusal))
    );
  }

  const result = await upsertInspectionMeasurement(db, {
    ...validation.data,
    companyId,
    userId
  });

  if (result.error) {
    return data(
      { error: result.error },
      await flash(request, error(result.error, "Failed to save measurement"))
    );
  }

  // No success flash — per-cell saves must be quiet; the matrix consumes the
  // returned ids/statuses to update itself.
  return data(result);
}
