import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { unassignStorageRule } from "@carbon/ee/rules.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "resources"
  });

  await requireFeature({
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
    ruleId,
    companyId
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
