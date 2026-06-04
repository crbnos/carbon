import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  evaluateLinesForSurface,
  isBlocked
} from "@carbon/ee/storage-rules.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { issueValidator } from "~/services/models";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(issueValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { jobOperationId, materialId, itemId, quantity, adjustmentType } =
    validation.data;

  const serviceRole = await getCarbonServiceRole();
  const acknowledged = formData.get("acknowledged") === "true";

  // Resolve workCenter context off the operation so workCenter-scoped rules
  // can evaluate against this materialIssue.
  // `workInstructionId` is in the runtime row but absent from the generated
  // DB types (stale until next regen). Select * and let the manual cast
  // below resolve the field; type only `workCenterId` directly off the row.
  const { data: jobOpRow } = await serviceRole
    .from("jobOperation")
    .select("workCenterId")
    .eq("id", jobOperationId)
    .maybeSingle();

  if (jobOpRow?.workCenterId) {
    const ruleEval = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      targetType: "workCenter",
      surface: "materialIssue",
      lines: [
        {
          lineId: jobOperationId,
          itemId,
          workCenterId: jobOpRow.workCenterId,
          operation: {
            id: jobOperationId,
            itemId,
            quantity,
            workInstructionId:
              (jobOpRow as { workInstructionId?: string | null })
                .workInstructionId ?? null
          },
          quantity
        }
      ]
    });
    if (
      ruleEval.violations.length > 0 &&
      isBlocked(ruleEval.violations, acknowledged)
    ) {
      return {
        error: null,
        data: null,
        violations: ruleEval.violations,
        ruleNames: ruleEval.ruleNames
      };
    }
  }

  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      id: jobOperationId,
      type: "partToOperation",
      itemId,
      materialId,
      quantity,
      adjustmentType,
      companyId,
      userId
    }
  });

  if (issue.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.operations,
      await flash(request, error(issue.error, "Failed to issue material"))
    );
  }

  throw redirect(requestReferrer(request) ?? path.to.operations);
}
