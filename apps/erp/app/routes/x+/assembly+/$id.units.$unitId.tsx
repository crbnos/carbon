import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyUnitValidator,
  upsertAssemblyUnit
} from "~/modules/production";

// Edit an authored subassembly unit in place — rename and/or change which parts
// it groups. Membership feeds the motion planner, so applying a change requires
// re-running motion planning (the editor nudges the user after saving).
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { unitId } = params;
  if (!unitId) throw new Error("unitId is not found");

  const validation = await validator(assemblyUnitValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to update unit"))
    );
  }

  // The URL param is the source of truth for which unit is edited.
  const { id: _id, ...rest } = validation.data;

  const update = await upsertAssemblyUnit(client, {
    ...rest,
    id: unitId,
    companyId,
    createdBy: userId,
    updatedBy: userId
  });
  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update unit"))
    );
  }

  return { success: true, id: update.data?.id };
}
