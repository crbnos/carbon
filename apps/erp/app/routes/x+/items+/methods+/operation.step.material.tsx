import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  setMethodMaterialStepLink
} from "~/modules/items";

// Toggle a part↔step link from the step editor's "Parts" picker (method/item tier).
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, { update: "parts" });

  const formData = await request.formData();
  const methodMaterialId = String(formData.get("materialId") ?? "");
  const methodOperationStepId = String(formData.get("stepId") ?? "");
  const linked = formData.get("linked") === "true";

  if (!methodMaterialId || !methodOperationStepId) {
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

  const result = await setMethodMaterialStepLink(client, {
    methodMaterialId,
    methodOperationStepId,
    linked
  });
  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to update step parts"))
    );
  }

  return { success: true };
}
