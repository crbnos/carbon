import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteApprovalRule } from "~/modules/shared";
import { getParams, path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "settings",
    role: "employee"
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
