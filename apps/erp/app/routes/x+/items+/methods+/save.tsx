import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getMethodValidator } from "~/modules/items";
import { copyItem, copyMakeMethod } from "~/modules/items/items.service.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const validation = await validator(getMethodValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  // Check if we're dealing with makeMethod IDs (format: make_xxxxx)
  // MakeMethodTools.tsx now sends makeMethod IDs directly
  const isMakeMethodId = (id: string) => id.startsWith("make_");

  const upsert =
    isMakeMethodId(validation.data.sourceId) ||
    isMakeMethodId(validation.data.targetId)
      ? await copyMakeMethod({
          ...validation.data,
          companyId,
          userId
        })
      : await copyItem({
          ...validation.data,
          companyId,
          userId
        });

  if (upsert.error) {
    return {
      error: upsert.error ? "Failed to save method" : null
    };
  }

  throw redirect(requestReferrer(request) ?? path.to.items);
}
