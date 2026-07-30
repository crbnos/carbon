import { success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { copyItem, copyMakeMethod, getMethodValidator } from "~/modules/items";
import { checkRevisionLock } from "~/modules/items/items.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const serviceRole = getCarbonServiceRole();

  const validation = await validator(getMethodValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  // Check if we're dealing with makeMethod IDs (format: make_xxxxx)
  // MakeMethodTools.tsx now sends makeMethod IDs directly
  const isMakeMethodId = (id: string) => id.startsWith("make_");

  // Release-lock gate: copyMakeMethod/copyItem OVERWRITE the target method's
  // materials + operations, so gate on the destination (target) item.
  const lock = await checkRevisionLock(serviceRole, {
    kind: isMakeMethodId(validation.data.targetId) ? "makeMethod" : "item",
    id: validation.data.targetId,
    companyId
  });
  if (!lock.ok) {
    return { error: lock.message };
  }

  const upsert =
    isMakeMethodId(validation.data.sourceId) ||
    isMakeMethodId(validation.data.targetId)
      ? await copyMakeMethod(serviceRole, {
          ...validation.data,
          companyId,
          userId
        })
      : await copyItem(serviceRole, {
          ...validation.data,
          companyId,
          userId
        });

  if (upsert.error) {
    return {
      error: upsert.error ? "Failed to save method" : null
    };
  }

  throw redirect(
    requestReferrer(request) ?? path.to.items,
    lock.warn ? await flash(request, success(lock.message)) : undefined
  );
}
