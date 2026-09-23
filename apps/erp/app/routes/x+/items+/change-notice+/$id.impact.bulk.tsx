import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  CHANGE_NOTICE_IMPACT_BULK_PREVIEW_STALE_MESSAGE,
  changeNoticeImpactDecisionBulkFormValidator
} from "~/modules/items";
import { writeAuthorizedChangeNoticeImpactDecisions } from "~/modules/items/items.server";

const impactBulkConflictMessages = [
  "This Impact target was assessed by someone else. Refresh and reassess.",
  "This Impact assessment changed before your update. Refresh and try again.",
  CHANGE_NOTICE_IMPACT_BULK_PREVIEW_STALE_MESSAGE
];

export function isChangeNoticeImpactBulkConflict(message: string) {
  return impactBulkConflictMessages.some((prefix) =>
    message.startsWith(prefix)
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const changeNoticeId = params.id;
  if (!changeNoticeId) throw new Error("Could not find id");

  const validation = await validator(
    changeNoticeImpactDecisionBulkFormValidator
  ).validate(await request.formData());
  if (validation.error) return validationError(validation.error);

  const {
    changeNoticeId: submittedChangeNoticeId,
    targets,
    decisionStatus,
    noActionReasonCode,
    rationale,
    resolutionNote,
    confirmNoPurchasingInterventionRemains
  } = validation.data;
  if (submittedChangeNoticeId !== changeNoticeId) {
    return data(
      {
        success: false,
        error: {
          message: "Impact bulk Change Notice does not match the route."
        }
      },
      await flash(
        request,
        error(null, "Impact bulk Change Notice does not match the route")
      )
    );
  }

  const result = await writeAuthorizedChangeNoticeImpactDecisions({
    client,
    companyId,
    userId,
    decision: {
      changeNoticeId,
      targets: targets.map((target) => ({
        ...target,
        decisionStatus,
        ...(noActionReasonCode ? { noActionReasonCode } : {}),
        ...(rationale ? { rationale } : {}),
        ...(resolutionNote ? { resolutionNote } : {}),
        ...(confirmNoPurchasingInterventionRemains
          ? { confirmNoPurchasingInterventionRemains: true }
          : {})
      }))
    }
  });

  if (result.error) {
    const conflict = isChangeNoticeImpactBulkConflict(result.error.message);
    return data(
      {
        success: false,
        error: result.error,
        ...(conflict ? { conflict: true } : {})
      },
      await flash(request, error(result.error, "Failed to apply Impact bulk"))
    );
  }

  return { success: true, data: result.data };
}
