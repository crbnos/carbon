import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyStepComponentsReassignValidator,
  reassignAssemblyStepComponents,
  syncAssemblyStepMaterialsFromMappings
} from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

// Assign the current selection to an existing step from the BOM tree. `move`
// pulls the components off whatever steps they were on; `duplicate` leaves those
// alone. The reassignment itself is one Kysely transaction; material sync (from
// the component→BOM mappings) is a best-effort follow-up, mirroring the
// per-step components autosave route.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw notFound("id is not found");

  const validation = await validator(
    assemblyStepComponentsReassignValidator
  ).validate(await request.formData());

  if (validation.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(validation.error, "Failed to assign components")
      )
    );
  }

  const { targetStepId, componentNodeIds, mode } = validation.data;

  try {
    await reassignAssemblyStepComponents(getDatabaseClient(), {
      assemblyInstructionId: id,
      companyId,
      targetStepId,
      componentNodeIds,
      mode,
      updatedBy: userId
    });
  } catch (err) {
    return data(
      { success: false },
      await flash(request, error(err, "Failed to assign components"))
    );
  }

  // Pull the mapped BOM items for the added components onto the target step.
  // Nothing to sync for a pure remove (no target step).
  if (targetStepId) {
    await syncAssemblyStepMaterialsFromMappings(client, {
      assemblyInstructionId: id,
      companyId,
      userId,
      stepIds: [targetStepId],
      onlyComponentNodeIds: componentNodeIds
    });
  }

  return { success: true };
}
