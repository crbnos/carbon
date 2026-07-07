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

  // 1. Slice events + record quantities + finish members + close batch (one txn).
  const completeResult = await serviceRole.functions.invoke<{
    memberIds?: string[];
    eventIds?: string[];
    error?: string;
  }>("batch-operations", {
    body: {
      type: "complete",
      batchId,
      members: validation.data.members,
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

  // 2. Issue materials per member via each job's own BOM (mirrors complete.tsx).
  const issueFailures: string[] = [];
  for (const member of validation.data.members) {
    if (member.quantity <= 0) continue;
    const issue = await serviceRole.functions.invoke("issue", {
      body: {
        id: member.jobOperationId,
        type: "jobOperation",
        quantity: member.quantity,
        companyId,
        userId
      }
    });
    if (issue.error) issueFailures.push(member.jobOperationId);
  }

  // 3. Post GL per sliced event (mirrors finishJobOperation's loop).
  const eventIds = completeResult.data?.eventIds ?? [];
  await Promise.all(
    eventIds.map((productionEventId) =>
      serviceRole.functions.invoke("post-production-event", {
        body: { productionEventId, userId, companyId }
      })
    )
  );

  if (issueFailures.length > 0) {
    return redirect(
      path.to.operations,
      await flash(
        request,
        error(
          `Batch completed, but material issue failed for ${issueFailures.length} job(s)`,
          "Partial completion"
        )
      )
    );
  }

  return redirect(
    path.to.operations,
    await flash(request, success("Batch completed"))
  );
}
