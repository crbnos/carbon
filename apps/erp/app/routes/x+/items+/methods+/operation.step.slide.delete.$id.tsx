import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  deleteMethodOperationStepSlide
} from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const slide = await client
    .from("methodOperationStepSlide")
    .select("stepId")
    .eq("id", id)
    .single();

  if (slide.error || !slide.data) {
    throw new Error("Slide not found");
  }

  const step = await client
    .from("methodOperationStep")
    .select("operationId")
    .eq("id", slide.data.stepId)
    .single();

  if (step.error || !step.data) {
    throw new Error("Step not found");
  }

  await assertMethodOperationIsDraft(client, step.data.operationId);

  const deleteSlide = await deleteMethodOperationStepSlide(client, id);
  if (deleteSlide.error) {
    return data(
      { id: null },
      await flash(
        request,
        error(deleteSlide.error, "Failed to delete operation step slide")
      )
    );
  }

  return {};
}
