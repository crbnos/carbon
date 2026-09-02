import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { assignSalesRule } from "@carbon/ee/rules";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "SALES_RULES",
    redirectTo: path.to.salesRules
  });

  const { itemId } = params;
  if (!itemId) throw new Error("itemId required");

  const formData = await request.formData();
  const ruleId = String(formData.get("ruleId") ?? "");
  if (!ruleId) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.salesRules,
      await flash(request, error(null, "Rule id required"))
    );
  }

  const result = await assignSalesRule(client, {
    itemId,
    ruleId,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.salesRules,
      await flash(request, error(result.error, "Failed to assign rule"))
    );
  }

  throw redirect(
    request.headers.get("Referer") ?? path.to.salesRules,
    await flash(request, success("Rule assigned"))
  );
}
