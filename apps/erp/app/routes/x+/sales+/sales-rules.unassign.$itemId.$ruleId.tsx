import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { unassignSalesRule } from "@carbon/ee/rules";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "sales"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "SALES_RULES",
    redirectTo: path.to.salesRules
  });

  const { itemId, ruleId } = params;
  if (!itemId || !ruleId) throw new Error("itemId and ruleId required");

  const result = await unassignSalesRule(client, {
    itemId,
    ruleId,
    companyId
  });
  if (result.error) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.salesRules,
      await flash(request, error(result.error, "Failed to unassign rule"))
    );
  }

  throw redirect(
    request.headers.get("Referer") ?? path.to.salesRules,
    await flash(request, success("Rule unassigned"))
  );
}
