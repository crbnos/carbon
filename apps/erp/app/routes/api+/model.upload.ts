// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { insertModelUpload } from "~/modules/items";
import { isAssemblerServiceHealthy } from "~/modules/production/production.server";

const logger = getLogger("erp", "model-upload");

const optional = (value: FormDataEntryValue | null) =>
  typeof value === "string" && value ? value : undefined;

// The browser's second step after it has staged the file. API callers use the
// `items_createModelUploadUrl` + `items_insertModelUpload` tools, which share
// `insertModelUpload` with this route.
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const modelId = formData.get("modelId") as string;
  const name = formData.get("name") as string;
  const modelPath = formData.get("modelPath") as string;
  const size = parseInt(formData.get("size") as string);

  if (!modelId) {
    throw new Error("File ID is required");
  }
  if (!name) {
    throw new Error("Name is required");
  }
  if (!modelPath) {
    throw new Error("Model path is required");
  }

  // Conversion to assembly-instruction artifacts (GLB + graph) is lazy by
  // default: most uploaded models never become assemblies. Callers that will
  // render the model on the shop floor (e.g. BOP step model slides) opt in
  // with `convert` so the assembler service produces the fast-loading GLB up
  // front. Best-effort: skipped when the assembler is down — the viewer falls
  // back to parsing the raw model client-side.
  const convert =
    formData.get("convert") === "true" && (await isAssemblerServiceHealthy());

  const result = await insertModelUpload(client, {
    companyId,
    createdBy: userId,
    modelId,
    path: modelPath,
    name,
    size,
    itemId: optional(formData.get("itemId")),
    jobId: optional(formData.get("jobId")),
    salesRfqLineId: optional(formData.get("salesRfqLineId")),
    quoteLineId: optional(formData.get("quoteLineId")),
    salesOrderLineId: optional(formData.get("salesOrderLineId")),
    convert
  });

  if (result.error) {
    logger.error("Failed to record model upload", {
      companyId,
      modelId,
      error: result.error
    });
    throw new Error("Failed to record upload: " + result.error.message);
  }

  return {
    success: true
  };
}
