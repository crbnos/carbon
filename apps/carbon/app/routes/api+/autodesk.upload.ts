import { json, type ActionFunctionArgs } from "@remix-run/node";
import { triggerClient } from "~/lib/trigger.server";
import { upsertModelUpload } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const formData = await request.formData();
  const fileId = formData.get("fileId") as string;
  const name = formData.get("name") as string;
  const modelPath = formData.get("modelPath") as string;
  const itemId = (formData.get("itemId") ?? undefined) as string | undefined;

  const modelRecord = await upsertModelUpload(client, {
    id: fileId,
    modelPath,
    itemId,
    companyId,
    createdBy: userId,
  });

  if (modelRecord.error) {
    throw new Error("Failed to record upload: " + modelRecord.error.message);
  }

  try {
    await triggerClient.sendEvent({
      name: "autodesk.upload",
      payload: {
        name,
        modelPath,
        companyId,
        fileId,
        itemId,
        userId,
      },
    });
  } catch (err) {
    return json({}, await flash(request, error(err, "Failed to upload model")));
  }

  return json({});
}
