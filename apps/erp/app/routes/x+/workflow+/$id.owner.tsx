import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateWorkflowOwner } from "~/modules/workflows";

// A workflow runs with its owner's permissions. This route therefore IGNORES any
// submitted id and always writes the session user — a route that accepted an
// arbitrary ownerId would let anyone who can edit a workflow borrow someone
// else's access. If you find yourself adding an `ownerId` form field, STOP.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "workflows"
  });

  const { id } = params;
  if (!id) throw new Error("id is not found");

  const updated = await updateWorkflowOwner(client, { id, companyId, userId });

  if (updated.error) {
    return data(
      { success: false },
      await flash(request, error(updated.error, "Failed to take ownership"))
    );
  }

  return data(
    { success: true },
    await flash(request, success("You now own this workflow"))
  );
}
