import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getOnshapeV2Settings, writeElementMapping } from "@carbon/ee/onshape";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const logger = getLogger("erp", "integrations-onshape-v2-import");

export const onshapeV2ImportValidator = z.object({
  makeMethodId: z.string().min(1),
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  elementId: z.string().min(1),
  /** Link the target item to this assembly as part of the import. */
  partNumber: zfd.text(z.string().optional()),
  revision: zfd.text(z.string().optional()),
  elementType: zfd.numeric(z.number().optional())
});

/**
 * Kick off a v2 BOM import.
 *
 * The write itself is an Inngest job — it makes real Onshape export calls and
 * walks a tree, so holding a request open for it is what made the legacy path
 * un-retryable. What happens HERE is only the cheap validation, so a user who
 * picked the wrong method finds out immediately rather than from a job that
 * failed somewhere they cannot see.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(onshapeV2ImportValidator).validate(
    formData
  );
  if (validation.error) {
    return { success: false, message: "Invalid import request" };
  }
  const input = validation.data;

  const settings = await getOnshapeV2Settings(client, companyId);
  if (!settings.isV2) {
    return {
      success: false,
      message: "Onshape v2 is not enabled for this company"
    };
  }

  // Same three refusals the job makes, checked up front so the user sees them
  // now. The job re-checks — this is for the message, not for safety.
  const method = await client
    .from("makeMethod")
    .select("id, itemId, status, changeOrderId")
    .eq("id", input.makeMethodId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (method.error || !method.data) {
    return { success: false, message: "Make method not found" };
  }
  if (method.data.status !== "Draft") {
    return {
      success: false,
      message: `Onshape can only import into a Draft method. This one is ${method.data.status} — create a new version first.`
    };
  }
  if (method.data.changeOrderId) {
    return {
      success: false,
      message:
        "This method belongs to an open change notice. Import into the item's own draft instead, so releasing the notice cannot ship what the import left."
    };
  }

  // Link the item being imported INTO to the assembly it came from, so the
  // next import resolves the parent by id like every other row. Without this
  // the top-level item is the one thing in the tree still joined by nothing.
  if (input.partNumber) {
    try {
      await writeElementMapping(getCarbonServiceRole(), {
        companyId,
        itemId: method.data.itemId,
        ref: {
          documentId: input.documentId,
          elementId: input.elementId,
          partId: null
        },
        metadata: {
          elementType: input.elementType,
          versionId: input.versionId,
          partNumber: input.partNumber,
          fromUnreleasedVersion: !input.revision,
          lastSyncedAt: new Date().toISOString()
        },
        createdBy: userId
      });
    } catch (error) {
      logger.error("Failed to link the target item to its Onshape assembly", {
        error
      });
      return {
        success: false,
        message: "Could not link this item to the Onshape assembly"
      };
    }
  }

  await trigger("onshape-bom-import", {
    companyId,
    userId,
    makeMethodId: input.makeMethodId,
    documentId: input.documentId,
    versionId: input.versionId,
    elementId: input.elementId
  });

  return {
    success: true,
    message:
      "Import started. The bill of materials updates in the background — reload the page in a moment to see it."
  };
}
