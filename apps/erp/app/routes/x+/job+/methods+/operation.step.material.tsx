import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { setJobMaterialStepLink } from "~/modules/production";

// Toggle a part↔step link from the step editor's "Parts" picker (job tier).
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const jobMaterialId = String(formData.get("materialId") ?? "");
  const jobOperationStepId = String(formData.get("stepId") ?? "");
  const linked = formData.get("linked") === "true";
  // Per-step share of the BOM line; absent/blank = the full line quantity.
  // Zero is refused — a step that uses none of a part should be unlinked.
  const rawQuantity = formData.get("quantity");
  const quantity =
    rawQuantity === null || String(rawQuantity).trim() === ""
      ? null
      : Number(rawQuantity);

  if (
    !jobMaterialId ||
    !jobOperationStepId ||
    (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))
  ) {
    return data({ success: false }, { status: 400 });
  }

  // Verify the step belongs to the caller's company before linking. The
  // join-table RLS only checks the material's company, not the step side
  // (jobMaterialStep has no companyId), so an unscoped stepId could otherwise
  // link across tenants. The RLS-scoped read returns nothing for a foreign step.
  const step = await client
    .from("jobOperationStep")
    .select("id")
    .eq("id", jobOperationStepId)
    .single();
  if (step.error || !step.data) {
    return data({ success: false }, { status: 404 });
  }

  // A step's share can never exceed the BOM line quantity — the line is the
  // source of truth for what the job requires.
  if (linked && quantity !== null) {
    const material = await client
      .from("jobMaterial")
      .select("quantity")
      .eq("id", jobMaterialId)
      .single();
    if (material.error || !material.data) {
      return data({ success: false }, { status: 404 });
    }
    if (material.data.quantity !== null && quantity > material.data.quantity) {
      return data({ success: false }, { status: 400 });
    }
  }

  const result = await setJobMaterialStepLink(client, {
    jobMaterialId,
    jobOperationStepId,
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
