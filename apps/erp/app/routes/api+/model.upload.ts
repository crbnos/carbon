// import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const modelId = formData.get("modelId") as string;
  const name = formData.get("name") as string;
  const modelPath = formData.get("modelPath") as string;
  const size = parseInt(formData.get("size") as string);

  const itemId = formData.get("itemId") as string | null;
  const salesRfqLineId = formData.get("salesRfqLineId") as string | null;
  const quoteLineId = formData.get("quoteLineId") as string | null;
  const salesOrderLineId = formData.get("salesOrderLineId") as string | null;
  const jobId = formData.get("jobId") as string | null;

  if (!modelId) {
    throw new Error("File ID is required");
  }
  if (!name) {
    throw new Error("Name is required");
  }
  if (!modelPath) {
    throw new Error("Model path is required");
  }
  // The path is client-supplied; never let it point outside this tenant's
  // storage prefix or escape via traversal.
  if (!modelPath.startsWith(`${companyId}/`) || modelPath.includes("..")) {
    throw new Error("Invalid model path");
  }

  const modelRecord = await client.from("modelUpload").insert({
    id: modelId,
    modelPath,
    name,
    size,
    // Frozen as-uploaded bytes: `size` is later overwritten with the compacted
    // (.zst) stored size, but the viewer's reduction badge compares the original.
    originalSize: size,
    companyId,
    createdBy: userId
  });

  if (modelRecord.error) {
    throw new Error("Failed to record upload: " + modelRecord.error.message);
  }

  if (itemId) {
    await client
      .from("item")
      .update({ modelUploadId: modelId })
      .eq("id", itemId);
  }
  if (salesRfqLineId) {
    await client
      .from("salesRfqLine")
      .update({ modelUploadId: modelId })
      .eq("id", salesRfqLineId);
  }
  if (quoteLineId) {
    await client
      .from("quoteLine")
      .update({ modelUploadId: modelId })
      .eq("id", quoteLineId);
  }
  if (salesOrderLineId) {
    await client
      .from("salesOrderLine")
      .update({ modelUploadId: modelId })
      .eq("id", salesOrderLineId);
  }
  if (jobId) {
    await client.from("job").update({ modelUploadId: modelId }).eq("id", jobId);
  }

  await trigger("model-thumbnail", {
    companyId,
    modelId
  });

  // Eager optimisation: the assembler's /v1/optimize turns a mesh model into a
  // compact optimised GLB. The job derives the format from the stored file and
  // skips non-mesh inputs, so trigger unconditionally. Independent of the lazy
  // assembly-convert path — most uploads never become assemblies but should
  // still be optimised.
  await trigger("model-optimize", {
    modelUploadId: modelId,
    companyId,
    userId
  });

  return {
    success: true
  };
}
