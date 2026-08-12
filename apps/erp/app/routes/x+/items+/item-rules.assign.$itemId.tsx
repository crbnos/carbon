import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { assignItemRule } from "~/modules/items";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "ITEM_RULES",
    redirectTo: path.to.itemRules
  });

  const { itemId } = params;
  if (!itemId) throw new Error("itemId required");

  const formData = await request.formData();
  const ruleId = String(formData.get("ruleId") ?? "");
  if (!ruleId) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.itemRules,
      await flash(request, error(null, "Rule id required"))
    );
  }

  const result = await assignItemRule(client, {
    itemId,
    ruleId,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.itemRules,
      await flash(request, error(result.error, "Failed to assign rule"))
    );
  }

  throw redirect(
    request.headers.get("Referer") ?? path.to.itemRules,
    await flash(request, success("Rule assigned"))
  );
}
