import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { updateIssueActionProcesses } from "~/modules/quality/quality.service";

const updateProcessesSchema = z.object({
  id: z.string(),
  processIds: z.array(z.string()).optional()
});

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const body = await request.json();
  const validated = updateProcessesSchema.safeParse(body);

  if (!validated.success) {
    return data({ error: "Invalid request data" }, { status: 400 });
  }

  const { processIds = [] } = validated.data;

  const updateProcesses = await updateIssueActionProcesses({
    actionTaskId: id,
    processIds
  });

  if (updateProcesses.error) {
    return data({ error: updateProcesses.error.message }, { status: 400 });
  }

  return { success: true };
}
