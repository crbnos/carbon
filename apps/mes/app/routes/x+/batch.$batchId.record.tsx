import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { batchStepRecordsValidator } from "~/services/models";
import {
  backflushUntrackedMaterialsOnStepRecord,
  insertBatchStepRecords
} from "~/services/operations.service";

const log = getLogger("mes");

// Records one work-instruction step for several batch members at once — the
// batch view's counterpart of x+/record, with the same per-step backflush.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});
  const { batchId } = params;
  if (!batchId) throw new Error("Batch ID is required");

  const validation = await validator(batchStepRecordsValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = await getCarbonServiceRole();
  const inserted = await insertBatchStepRecords(serviceRole, {
    batchId,
    companyId,
    createdBy: userId,
    records: validation.data.records
  });
  if (inserted.error) {
    return data(
      {},
      await flash(request, error(inserted.error, "Failed to record step"))
    );
  }

  // One backflush per recorded step, as if each job had recorded its own.
  const backflushes = await Promise.all(
    validation.data.records.map((record) =>
      backflushUntrackedMaterialsOnStepRecord(serviceRole, {
        jobOperationStepId: record.jobOperationStepId,
        companyId,
        userId
      })
    )
  );
  for (const [i, backflush] of backflushes.entries()) {
    if (backflush.error) {
      log.error("Backflush on batch step record failed", {
        error: backflush.error,
        jobOperationStepId: validation.data.records[i]?.jobOperationStepId
      });
    }
  }

  return data(
    { success: true },
    await flash(
      request,
      success(`Recorded for ${validation.data.records.length} jobs`)
    )
  );
}
