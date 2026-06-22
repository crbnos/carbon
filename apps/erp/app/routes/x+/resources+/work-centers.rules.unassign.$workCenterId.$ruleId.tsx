import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect } from "react-router";
import { unassignStorageRule } from "~/modules/storage-rules";
import { path } from "~/utils/path";
import { getCompanyId, storageRuleAssignmentsQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "resources"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "STORAGE_RULES",
    redirectTo: path.to.storageRules
  });

  const { workCenterId, ruleId } = params;
  if (!workCenterId || !ruleId)
    throw new Error("workCenterId and ruleId required");

  const result = await unassignStorageRule(client, {
    targetType: "workCenter",
    targetId: workCenterId,
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
  const { workCenterId } = params;
  if (workCenterId) {
    window?.clientCache?.setQueryData(
      storageRuleAssignmentsQuery("workCenter", workCenterId, getCompanyId())
        .queryKey,
      null
    );
  }
  return await serverAction();
}
