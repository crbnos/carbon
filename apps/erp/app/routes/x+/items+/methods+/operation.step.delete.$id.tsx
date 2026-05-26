import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  deleteMethodOperationStep
} from "~/modules/items/items.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const step = await client
    .from("methodOperationStep")
    .select("operationId")
    .eq("id", id)
    .single();

  if (step.error || !step.data) {
    throw new Error("Step not found");
  }

  await assertMethodOperationIsDraft(step.data.operationId);

  const deleteOperationStep = await deleteMethodOperationStep(id);
  if (deleteOperationStep.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(
          deleteOperationStep.error,
          "Failed to delete method operation step"
        )
      )
    );
  }

  return {};
}
