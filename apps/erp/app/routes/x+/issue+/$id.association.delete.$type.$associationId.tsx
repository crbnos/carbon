import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  deleteIssueAssociation,
  getIssue,
  isIssueLocked,
  nonConformanceAssociationType
} from "~/modules/quality";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "quality"
  });

  const { id, type, associationId } = params;
  if (!id) throw new Error("Could not find id");
  if (!type) throw new Error("Could not find type");
  if (!associationId) throw new Error("Could not find associationId");

  await requirePermissions(request, {
    view: "quality"
  });
  const issue = await getIssue(id);
  await requireUnlocked({
    request,
    isLocked: isIssueLocked(issue.data?.status),
    redirectTo: requestReferrer(request) ?? path.to.issue(id),
    message: "Cannot modify a closed issue. Reopen it first."
  });

  // @ts-expect-error
  if (!nonConformanceAssociationType.includes(type)) {
    throw new Error(`Invalid type: ${type}`);
  }

  const deletion = await deleteIssueAssociation(type, associationId);

  if (deletion.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.issue(id),
      await flash(
        request,
        error(deletion.error, "Failed to delete association")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.issue(id),
    await flash(request, success("Successfully deleted association"))
  );
}
