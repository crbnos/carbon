import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { deleteApprovalRule } from "@carbon/ee/approvals.server";
import { requireFeature } from "@carbon/ee/plan.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getParams, path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "settings",
    role: "employee"
  });

  await requireFeature({
    request,
    client,
    companyId,
    redirectTo: path.to.settings,
    feature: "APPROVAL_RULES"
  });

  const { id } = params;
  if (!id) throw new Error("Rule ID is required");

  const result = await deleteApprovalRule(client, id, companyId);

  if (result.error) {
    throw redirect(
      path.to.approvalRules,
      await flash(
        request,
        error(result.error, "Failed to delete approval rule")
      )
    );
  }

  throw redirect(
    `${path.to.approvalRules}?${getParams(request)}`,
    await flash(request, success("Approval rule deleted successfully"))
  );
}
