import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { issueTrackedEntityValidator } from "~/services/models";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const payload = await request.json();
  const validation = issueTrackedEntityValidator.safeParse(payload);

  if (!validation.success) {
    return json(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const { materialId, parentTrackedEntityId, children } = validation.data;

  const serviceRole = await getCarbonServiceRole();
  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      type: "trackedEntitiesToOperation",
      materialId,
      parentTrackedEntityId,
      children,
      companyId,
      userId,
    },
    region: FunctionRegion.UsEast1,
  });

  if (issue.error) {
    console.error(issue.error);
    return json(
      { success: false, message: "Failed to issue material" },
      { status: 400 }
    );
  }

  const splitEntities = issue.data?.splitEntities || [];

  return json({
    success: true,
    message: "Material issued successfully",
    splitEntities,
  });
}
