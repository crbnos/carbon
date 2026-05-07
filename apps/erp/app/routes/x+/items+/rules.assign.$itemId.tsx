import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect } from "react-router";
import { assignItemRule } from "~/modules/items";
import { path } from "~/utils/path";
import { requirePlan } from "~/utils/planGate.server";
import { getCompanyId, itemRuleAssignmentsQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  await requirePlan({
    request,
    client,
    companyId,
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
    userId
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
