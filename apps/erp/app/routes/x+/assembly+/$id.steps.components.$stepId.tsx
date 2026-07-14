import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyInstructionStepComponentsValidator,
  syncAssemblyStepMaterialsFromMappings,
  updateAssemblyStepComponents
} from "~/modules/production";

// Autosave target for the Details panel's Add/remove component controls: patches
// only the step's assigned components, leaving the rest of the step untouched.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id, stepId } = params;
  if (!id) throw notFound("id is not found");
  if (!stepId) throw notFound("step id is not found");

  const validation = await validator(
    assemblyInstructionStepComponentsValidator
  ).validate(await request.formData());

  if (validation.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(validation.error, "Failed to update components")
      )
    );
  }

  // Captured before the update so newly added components can be auto-matched
  // to BOM items below.
  const previous = await client
    .from("assemblyInstructionStep")
    .select("componentNodeIds")
    .eq("id", stepId)
    .single();

  const update = await updateAssemblyStepComponents(client, {
    id: stepId,
    componentNodeIds: validation.data.componentNodeIds,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update components"))
    );
  }

  // Components added to the step pull their mapped BOM items onto the step's
  // materials. Additive only — removals and manual material edits are left alone.
  const previousNodeIds = new Set(previous.data?.componentNodeIds ?? []);
  const addedNodeIds = validation.data.componentNodeIds.filter(
    (nodeId) => !previousNodeIds.has(nodeId)
  );
  if (addedNodeIds.length > 0) {
    await syncAssemblyStepMaterialsFromMappings(client, {
      assemblyInstructionId: id,
      companyId,
      userId,
      stepIds: [stepId],
      onlyComponentNodeIds: addedNodeIds
    });
  }

  return { success: true };
}
