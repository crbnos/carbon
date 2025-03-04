import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { z } from "zod";

const issueTrackedEntityValidator = z.object({
  id: z.string(),
  parentId: z.string(),
  children: z.array(
    z.object({
      trackedEntityId: z.string(),
      quantity: z.number(),
    })
  ),
});

export async function action({ request }: ActionFunctionArgs) {
  console.log("issue-tracked-entity");
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const payload = await request.json();
  const validation = issueTrackedEntityValidator.safeParse(payload);

  console.log(validation)

  if (!validation.success) {
    return json({ success: false, message: "Failed to validate payload" }, { status: 400 });
  }

  const { id, parentId, children } = validation.data;

  const serviceRole = await getCarbonServiceRole();
  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      type: "trackedEntitiesToOperation",
      id,
      activityDescription: "Issue",
      parentId,
      children,
      companyId,
      userId,
    },
  });

  if (issue.error) {
    console.error(issue.error);
    return json({ success: false, message: "Failed to issue material" }, { status: 400 });
  }

  return json({ success: true, message: "Material issued successfully" });
}
