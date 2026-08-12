import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { unassignItemRule } from "~/modules/items";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "parts"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "ITEM_RULES",
    redirectTo: path.to.itemRules
  });

  const { itemId, ruleId } = params;
  if (!itemId || !ruleId) throw new Error("itemId and ruleId required");

  const result = await unassignItemRule(client, {
    itemId,
    ruleId,
    companyId
  });
  if (result.error) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.itemRules,
      await flash(request, error(result.error, "Failed to unassign rule"))
    );
  }

  throw redirect(
    request.headers.get("Referer") ?? path.to.itemRules,
    await flash(request, success("Rule unassigned"))
  );
}
