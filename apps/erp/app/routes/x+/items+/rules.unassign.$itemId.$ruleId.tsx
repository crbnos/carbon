import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect } from "react-router";
import { unassignStorageRule } from "~/modules/storageRules";
import { path } from "~/utils/path";
import { getCompanyId, storageRuleAssignmentsQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "STORAGE_RULES",
    redirectTo: path.to.storageRules
  });

  const { itemId, ruleId } = params;
  if (!itemId || !ruleId) throw new Error("itemId and ruleId required");

  const result = await unassignStorageRule(client, {
    targetType: "item",
    targetId: itemId,
    ruleId
  });
  if (result.error) {
    throw redirect(
      request.headers.get("Referer") ?? path.to.storageRules,
      await flash(request, error(result.error, "Failed to unassign rule"))
    );
  }

  throw redirect(
    request.headers.get("Referer") ?? path.to.storageRules,
    await flash(request, success("Rule unassigned"))
  );
}

export async function clientAction({
  serverAction,
  params
}: ClientActionFunctionArgs) {
  const { itemId } = params;
  if (itemId) {
    window?.clientCache?.setQueryData(
      storageRuleAssignmentsQuery("item", itemId, getCompanyId()).queryKey,
      null
    );
  }
  return await serverAction();
}
