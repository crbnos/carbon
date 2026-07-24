import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { stepRecordValidator } from "~/services/models";
import {
  backflushLooseMaterialsAtFirstStep,
  insertAttributeRecord
} from "~/services/operations.service";

const log = getLogger("mes");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(stepRecordValidator).validate(formData);
  const serviceRole = await getCarbonServiceRole();

  if (validation.error) {
    return validationError(validation.error);
  }

  const attributeRecord = await insertAttributeRecord(serviceRole, {
    ...validation.data,
    companyId,
    createdBy: userId
  });

  if (attributeRecord.error) {
    return data(
      {},
      await flash(
        request,
        error(attributeRecord.error, "Failed to record attribute")
      )
    );
  }

  // Recording a unit's FIRST step auto-issues one unit's worth of the
  // operation's loose materials (untracked, not assigned to any step) —
  // the operator builds unit by unit and never scans these. A backflush
  // failure (e.g. insufficient stock) never blocks the record; the part
  // just stays manually issuable.
  const backflush = await backflushLooseMaterialsAtFirstStep(serviceRole, {
    jobOperationStepId: validation.data.jobOperationStepId,
    companyId,
    userId
  });
  if (backflush.error) {
    log.error("Backflush on first-step record failed", {
      error: backflush.error,
      jobOperationStepId: validation.data.jobOperationStepId
    });
  }

  return data(
    { success: true },
    await flash(request, success("Attribute recorded successfully"))
  );
}
