import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { changeNoticeImpactDecisionFormValidator } from "~/modules/items";
import { writeAuthorizedChangeNoticeImpactDecision } from "~/modules/items/items.server";

const impactDecisionConflictMessages = new Set([
  "This Impact target was assessed by someone else. Refresh and reassess.",
  "This Impact assessment changed before your update. Refresh and try again."
]);

export function isChangeNoticeImpactDecisionConflict(message: string) {
  return impactDecisionConflictMessages.has(message);
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const changeNoticeId = params.id;
  if (!changeNoticeId) throw new Error("Could not find id");

  const validation = await validator(
    changeNoticeImpactDecisionFormValidator
  ).validate(await request.formData());
  if (validation.error) return validationError(validation.error);

  const {
    changeNoticeId: submittedChangeNoticeId,
    confirmNoPurchasingInterventionRemains,
    ...decision
  } = validation.data;
  if (submittedChangeNoticeId !== changeNoticeId) {
    return data(
      {
        success: false,
        error: {
          message: "Impact decision Change Notice does not match the route."
        }
      },
      await flash(
        request,
        error(null, "Impact decision Change Notice does not match the route")
      )
    );
  }

  const result = await writeAuthorizedChangeNoticeImpactDecision({
    client,
    companyId,
    userId,
    decision: {
      ...decision,
      ...(confirmNoPurchasingInterventionRemains
        ? { confirmNoPurchasingInterventionRemains: true }
        : {}),
      changeNoticeId
    }
  });

  if (result.error) {
    const conflict = isChangeNoticeImpactDecisionConflict(result.error.message);
    return data(
      {
        success: false,
        error: result.error,
        ...(conflict ? { conflict: true } : {})
      },
      await flash(
        request,
        error(result.error, "Failed to save Impact decision")
      )
    );
  }

  return { success: true, data: result.data };
}
