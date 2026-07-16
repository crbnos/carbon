import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { checkRevisionLock } from "~/modules/items/items.server";
import { activateMethodVersion } from "~/modules/items/items.service";
import { requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const url = new URL(request.url);
  const methodToReplace = url.searchParams.get("methodToReplace");

  const { id } = params;
  if (!id) {
    return { success: false, message: "Invalid operation tool id" };
  }

  // Validate redirect inputs BEFORE mutating: activation switches the live
  // BOM/BOP, so a missing query param or referrer must fail without having
  // already flipped the method.
  if (!methodToReplace) {
    return {
      success: false,
      message: "Method to replace is required"
    };
  }

  const redirectPath = requestReferrer(request)?.replace(methodToReplace, id);

  if (!redirectPath) {
    return {
      success: false,
      message: "Failed to redirect to the correct page"
    };
  }

  const serviceRole = getCarbonServiceRole();

  // Release-lock gate: activating a make-method version switches the live
  // BOM/BOP for the item, so resolve the version's parent item and gate on it.
  const lock = await checkRevisionLock(serviceRole, {
    kind: "makeMethod",
    id,
    companyId
  });
  if (!lock.ok) {
    return { success: false, message: lock.message };
  }

  // No change-order gate here: the V1 change-order model applies BOM edits by
  // spinning fresh method versions at Done and never stages/reserves a pending
  // revision, so there is nothing for an open CO to lock against.

  const update = await activateMethodVersion(serviceRole, {
    id,
    companyId,
    userId
  });

  if (update.error) {
    return {
      success: false,
      message: "Failed to activate method version"
    };
  }

  return redirect(
    redirectPath,
    lock.warn ? await flash(request, success(lock.message)) : undefined
  );
}
