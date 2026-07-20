import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  deleteMethodOperationStep
} from "~/modules/items";
import { checkRevisionLock } from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
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

  // Release-lock gate: enforce -> block; warn -> proceed + flash; off -> no-op.
  const lock = await checkRevisionLock(client, {
    kind: "operation",
    id: step.data.operationId,
    companyId
  });
  if (!lock.ok) {
    return data({ id: null }, await flash(request, error(null, lock.message)));
  }

  await assertMethodOperationIsDraft(client, step.data.operationId);

  const deleteOperationStep = await deleteMethodOperationStep(client, id);
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

  if (lock.warn) {
    return data({}, await flash(request, success(lock.message)));
  }

  return {};
}
