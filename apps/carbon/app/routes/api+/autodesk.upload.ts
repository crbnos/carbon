import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { upsertModelUpload } from "~/modules/shared";
import type { autodeskUploadTask } from "~/trigger/autodesk-upload";

export const config = { runtime: "nodejs" };

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const formData = await request.formData();
  const fileId = formData.get("fileId") as string;
  const name = formData.get("name") as string;
  const modelPath = formData.get("modelPath") as string;

  const itemId = formData.get("itemId") as string | null;
  const salesRfqLineId = formData.get("salesRfqLineId") as string | null;
  const quoteLineId = formData.get("quoteLineId") as string | null;
  const salesOrderLineId = formData.get("salesOrderLineId") as string | null;
  const jobId = formData.get("jobId") as string | null;

  if (!fileId) {
    throw new Error("File ID is required");
  }
  if (!name) {
    throw new Error("Name is required");
  }
  if (!modelPath) {
    throw new Error("Model path is required");
  }

  if (itemId) {
    await client
      .from("item")
      .update({ modelUploadId: fileId })
      .eq("id", itemId);
  }
  if (salesRfqLineId) {
    await client
      .from("salesRfqLine")
      .update({ modelUploadId: fileId })
      .eq("id", salesRfqLineId);
  }
  if (quoteLineId) {
    await client
      .from("quoteLine")
      .update({ modelUploadId: fileId })
      .eq("id", quoteLineId);
  }
  if (salesOrderLineId) {
    await client
      .from("salesOrderLine")
      .update({ modelUploadId: fileId })
      .eq("id", salesOrderLineId);
  }
  if (jobId) {
    await client.from("job").update({ modelUploadId: fileId }).eq("id", jobId);
  }

  const modelRecord = await upsertModelUpload(client, {
    id: fileId,
    modelPath,
    companyId,
    createdBy: userId,
  });

  if (modelRecord.error) {
    throw new Error("Failed to record upload: " + modelRecord.error.message);
  }

  try {
    await tasks.trigger<typeof autodeskUploadTask>("autodesk-upload", {
      companyId,
      fileId,
      itemId,
      modelPath,
      name,
      quoteLineId,
      salesRfqLineId,
    });
  } catch (err) {
    return json({}, await flash(request, error(err, "Failed to upload model")));
  }

  return json({});
}
