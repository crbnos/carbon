import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getIssue,
  insertIssueReviewer,
  isIssueLocked,
  nonConformanceReviewerValidator
} from "~/modules/quality";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Non-conformance ID is required");

  await requirePermissions(request, {
    view: "quality"
  });
  const issue = await getIssue(id);
  await requireUnlocked({
    request,
    isLocked: isIssueLocked(issue.data?.status),
    redirectTo: path.to.issue(id),
    message: "Cannot modify a closed issue. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(nonConformanceReviewerValidator).validate(
    formData
  );

  if (validation.error) {
    return data(
      {
        success: false
      },
      await flash(request, error(validation.error, "Invalid reviewer"))
    );
  }

  const updateCurrency = await insertIssueReviewer({
    ...validation.data,
    nonConformanceId: id,
    companyId,
    createdBy: userId
  });

  if (updateCurrency.error) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error(updateCurrency.error, "Failed to insert reviewer")
      )
    );
  }

  return {
    success: true
  };
}
