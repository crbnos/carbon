import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { issueTrackedEntityValidator } from "~/services/models";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const payload = await request.json();
  const validation = issueTrackedEntityValidator.safeParse(payload);

  if (!validation.success) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const {
    materialId,
    jobOperationId,
    itemId,
    parentTrackedEntityId,
    children
  } = validation.data;

  const serviceRole = await getCarbonServiceRole();
  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      type: "trackedEntitiesToOperation",
      materialId,
      jobOperationId,
      itemId,
      parentTrackedEntityId,
      children,
      companyId,
      userId
    },
    region: FunctionRegion.UsEast1
  });

  if (issue.error) {
    console.error(issue.error);
    return data(
      { success: false, message: "Failed to issue material" },
      { status: 400 }
    );
  }

  const splitEntities = issue.data?.splitEntities || [];

  return {
    success: true,
    message: "Material issued successfully",
    splitEntities
  };
}
