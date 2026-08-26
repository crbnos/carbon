import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  setMethodOperationToolStepLink
} from "~/modules/items";

// Toggle a tool↔step link from the step editor's "Tools" picker (method/item tier).
// `toolId` is the tool ITEM id — the picker offers the whole tool library, and the
// service ensures the operation-level tool row exists before linking.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const toolId = String(formData.get("toolId") ?? "");
  const methodOperationStepId = String(formData.get("stepId") ?? "");
  const linked = formData.get("linked") === "true";

  if (!toolId || !methodOperationStepId) {
    return data({ success: false }, { status: 400 });
  }

  const step = await client
    .from("methodOperationStep")
    .select("operationId")
    .eq("id", methodOperationStepId)
    .single();
  if (step.error || !step.data) {
    return data({ success: false }, { status: 404 });
  }
  await assertMethodOperationIsDraft(client, step.data.operationId);

  const result = await setMethodOperationToolStepLink(client, {
    operationId: step.data.operationId,
    toolId,
    methodOperationStepId,
    linked,
    companyId,
    createdBy: userId
  });
  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to update step tools"))
    );
  }

  return { success: true };
}
