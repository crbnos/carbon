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
  // Per-step share of the BOM line; absent/blank = the full line quantity.
  // Zero is refused — a step that uses none of a part should be unlinked.
  const rawQuantity = formData.get("quantity");
  const quantity =
    rawQuantity === null || String(rawQuantity).trim() === ""
      ? null
      : Number(rawQuantity);

  if (
    !methodMaterialId ||
    !methodOperationStepId ||
    (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))
  ) {
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

  // A step's share can never exceed the BOM line quantity — the line is the
  // source of truth for what the method requires.
  if (linked && quantity !== null) {
    const material = await client
      .from("methodMaterial")
      .select("quantity")
      .eq("id", methodMaterialId)
      .single();
    if (material.error || !material.data) {
      return data({ success: false }, { status: 404 });
    }
    if (material.data.quantity !== null && quantity > material.data.quantity) {
      return data({ success: false }, { status: 400 });
    }
  }

  const result = await setMethodMaterialStepLink(client, {
    methodMaterialId,
    methodOperationStepId,
    linked,
    quantity
  });
  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to update step parts"))
    );
  }

  return { success: true };
}
