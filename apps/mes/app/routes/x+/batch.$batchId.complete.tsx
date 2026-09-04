import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { completeJobOperationBatchValidator } from "~/services/models";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });
  const { batchId } = params;
  if (!batchId) throw new Error("Batch ID is required");

  const validation = await validator(
    completeJobOperationBatchValidator
  ).validate(await request.formData());
  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = await getCarbonServiceRole();

  // The edge function owns the whole completion: slice events + record quantities
  // (phase 1, one txn), then issue each member's BOM + flip members Done + post GL
  // (phase 2, idempotent). A phase-2 failure leaves the batch 'Completing'; the
  // operator re-submitting this form re-invokes and resumes without double effects.
  const completeResult = await serviceRole.functions.invoke<{
    memberIds?: string[];
    error?: string;
  }>("batch-operations", {
    body: {
      type: "complete",
      batchId,
      // An excluded ("not in this run") member detaches back to the schedule;
      // its quantities are forced to 0 so a dimmed-but-stale input can never
      // record output for an operation that was not run.
      members: validation.data.members.map((m) => {
        const excluded = m.excluded === "true";
        return {
          jobOperationId: m.jobOperationId,
          quantity: excluded ? 0 : (m.quantity ?? 0),
          scrapQuantity: excluded ? 0 : (m.scrapQuantity ?? 0),
          excluded
        };
      }),
      companyId,
      userId
    }
  });

  if (completeResult.error || completeResult.data?.error) {
    return data(
      {},
      await flash(
        request,
        error(
          completeResult.error ?? completeResult.data?.error,
          "Failed to complete batch"
        )
      )
    );
  }

  return redirect(
    path.to.operations,
    await flash(request, success("Batch completed"))
  );
}
