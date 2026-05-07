import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect } from "react-router";
import { unassignItemRule } from "~/modules/items";
import { path } from "~/utils/path";
import { requirePlan } from "~/utils/planGate.server";
import { getCompanyId, itemRuleAssignmentsQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  await requirePlan({
    request,
    client,
    companyId,
    redirectTo: path.to.itemRules
  });

  const { itemId, ruleId } = params;
  if (!itemId || !ruleId) throw new Error("itemId and ruleId required");

  const result = await unassignItemRule(client, { itemId, ruleId });
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

export async function clientAction({
  serverAction,
  params
}: ClientActionFunctionArgs) {
  const { itemId } = params;
  if (itemId) {
    window?.clientCache?.setQueryData(
      itemRuleAssignmentsQuery(itemId, getCompanyId()).queryKey,
      null
    );
  }
  return await serverAction();
}
