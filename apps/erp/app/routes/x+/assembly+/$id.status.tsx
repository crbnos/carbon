import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  assemblyInstructionStatuses,
  updateAssemblyInstructionStatus
} from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof assemblyInstructionStatuses)[number];

  if (!status || !assemblyInstructionStatuses.includes(status)) {
    throw redirect(
      requestReferrer(request) ?? path.to.assemblyInstruction(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await updateAssemblyInstructionStatus(client, id, {
    status,
    updatedBy: userId
  });

  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.assemblyInstruction(id),
      await flash(
        request,
        error(update.error, "Failed to update assembly instruction status")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.assemblyInstruction(id),
    await flash(request, success("Updated assembly instruction status"))
  );
}
