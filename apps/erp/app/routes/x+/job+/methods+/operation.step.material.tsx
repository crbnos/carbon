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

  if (!jobMaterialId || !jobOperationStepId) {
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

  const result = await setJobMaterialStepLink(client, {
    jobMaterialId,
    jobOperationStepId,
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
