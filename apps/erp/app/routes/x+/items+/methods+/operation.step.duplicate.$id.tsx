import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  duplicateMethodOperationStep
} from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
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

  await assertMethodOperationIsDraft(client, step.data.operationId);

  const duplicate = await duplicateMethodOperationStep(client, {
    id,
    companyId,
    createdBy: userId
  });
  if (duplicate.error) {
    return data(
      { id: null },
      await flash(
        request,
        error(duplicate.error, "Failed to duplicate method operation step")
      )
    );
  }

  return { id: duplicate.data?.id ?? null };
}
