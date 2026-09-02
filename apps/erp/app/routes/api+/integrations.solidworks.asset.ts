import { requirePermissions } from "@carbon/auth/auth.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { getFileSizeLimit } from "@carbon/utils";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { stripSpecialCharacters } from "~/utils/string";

const logger = getLogger("erp", "integrations-solidworks-asset");

export const config = {
  runtime: "nodejs"
};

const STEP_EXTENSIONS = new Set(["step", "stp"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const THUMBNAIL_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);
const STAGING_BUCKET = "temp-staging";
const PRIVATE_BUCKET = "private";

function fileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";
}

/**
 * Attach an existing PDF or STEP the connector already validated on disk.
 * Reuses the Onshape attach landing zones: `temp-staging` + `modelUpload` for
 * STEP (then `carbon/model-optimize`), `private` + `document` for PDFs.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data(
      { success: false, message: "Method not allowed" },
      { status: 405 }
    );
  }

  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      update: "parts",
      create: "documents"
    });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return data(
      { success: false, message: "Expected multipart form data" },
      { status: 400 }
    );
  }

  const itemId = String(formData.get("itemId") ?? "");
  const kind = String(formData.get("kind") ?? "").toLowerCase();
  const file = formData.get("file");

  if (!itemId) {
    return data(
      { success: false, message: "itemId is required" },
      { status: 400 }
    );
  }
  if (kind !== "pdf" && kind !== "step" && kind !== "thumbnail") {
    return data(
      { success: false, message: "kind must be pdf, step, or thumbnail" },
      { status: 400 }
    );
  }
  if (!(file instanceof File) || file.size === 0) {
    return data(
      { success: false, message: "file is required" },
      { status: 400 }
    );
  }

  const extension = fileExtension(file.name);
  if (kind === "step" && !STEP_EXTENSIONS.has(extension)) {
    return data(
      { success: false, message: "STEP file must be .step or .stp" },
      { status: 400 }
    );
  }
  if (kind === "pdf" && !PDF_EXTENSIONS.has(extension)) {
    return data(
      { success: false, message: "Drawing file must be .pdf" },
      { status: 400 }
    );
  }
  if (kind === "thumbnail" && !THUMBNAIL_EXTENSIONS.has(extension)) {
    return data(
      { success: false, message: "Thumbnail must be .png, .jpg, or .jpeg" },
      { status: 400 }
    );
  }

  const sizeLimit =
    kind === "step"
      ? getFileSizeLimit("CAD_MODEL_UPLOAD")
      : kind === "thumbnail"
        ? getFileSizeLimit("DOCUMENT_UPLOAD")
        : getFileSizeLimit("DOCUMENT_UPLOAD");
  if (file.size > sizeLimit.bytes) {
    return data(
      {
        success: false,
        message: `File exceeds ${sizeLimit.format()} limit`
      },
      { status: 400 }
    );
  }

  const item = await client
    .from("item")
    .select("id")
    .eq("id", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (item.error || !item.data) {
    return data({ success: false, message: "Item not found" }, { status: 404 });
  }

  const safeName = stripSpecialCharacters(file.name) || `file.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    if (kind === "thumbnail") {
      const path = `${companyId}/thumbnails/${itemId}/${safeName}`;
      const contentType =
        extension === "png"
          ? "image/png"
          : extension === "jpg" || extension === "jpeg"
            ? "image/jpeg"
            : "application/octet-stream";
      const uploaded = await client.storage
        .from(PRIVATE_BUCKET)
        .upload(path, bytes, {
          upsert: true,
          contentType
        });
      if (uploaded.error) {
        logger.error("SolidWorks asset: thumbnail upload failed", {
          error: uploaded.error
        });
        return data(
          { success: false, message: "Failed to store thumbnail" },
          { status: 500 }
        );
      }

      const updated = await client
        .from("item")
        .update({ thumbnailPath: path })
        .eq("id", itemId)
        .eq("companyId", companyId);
      if (updated.error) {
        return data(
          { success: false, message: "Failed to attach thumbnail" },
          { status: 500 }
        );
      }

      return {
        success: true,
        kind: "thumbnail",
        thumbnailPath: path
      };
    }

    if (kind === "step") {
      const modelId = nanoid();
      const modelPath = `${companyId}/models/${modelId}.${extension}`;
      const uploaded = await client.storage
        .from(STAGING_BUCKET)
        .upload(modelPath, bytes, {
          upsert: true,
          contentType: "model/step"
        });
      if (uploaded.error) {
        logger.error("SolidWorks asset: STEP upload failed", {
          error: uploaded.error
        });
        return data(
          { success: false, message: "Failed to store STEP file" },
          { status: 500 }
        );
      }

      const modelRecord = await client.from("modelUpload").insert({
        id: modelId,
        modelPath,
        name: safeName,
        size: file.size,
        originalSize: file.size,
        originalPath: modelPath,
        companyId,
        createdBy: userId
      });
      if (modelRecord.error) {
        return data(
          { success: false, message: "Failed to record model upload" },
          { status: 500 }
        );
      }

      await client
        .from("item")
        .update({ modelUploadId: modelId })
        .eq("id", itemId)
        .eq("companyId", companyId);

      await trigger("model-optimize", {
        modelUploadId: modelId,
        companyId,
        userId
      });

      return {
        success: true,
        kind: "step",
        modelUploadId: modelId
      };
    }

    const path = `${companyId}/parts/${itemId}/${safeName}`;
    const uploaded = await client.storage
      .from(PRIVATE_BUCKET)
      .upload(path, bytes, {
        upsert: true,
        contentType: "application/pdf"
      });
    if (uploaded.error) {
      logger.error("SolidWorks asset: PDF upload failed", {
        error: uploaded.error
      });
      return data(
        { success: false, message: "Failed to store PDF" },
        { status: 500 }
      );
    }

    const groups = [companyGroupId || userId];
    const existing = await client
      .from("document")
      .select("id")
      .eq("companyId", companyId)
      .eq("path", path)
      .maybeSingle();

    if (existing.data?.id) {
      await client
        .from("document")
        .update({
          name: safeName,
          size: file.size,
          type: "PDF",
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", existing.data.id)
        .eq("companyId", companyId);
      return {
        success: true,
        kind: "pdf",
        documentId: existing.data.id
      };
    }

    const inserted = await client
      .from("document")
      .insert({
        path,
        name: safeName,
        size: file.size,
        type: "PDF",
        sourceDocument: "Part",
        sourceDocumentId: itemId,
        companyId,
        createdBy: userId,
        readGroups: groups,
        writeGroups: groups
      })
      .select("id")
      .single();

    if (inserted.error || !inserted.data?.id) {
      logger.error("SolidWorks asset: document insert failed", {
        error: inserted.error
      });
      return data(
        { success: false, message: "Failed to attach PDF" },
        { status: 500 }
      );
    }

    return {
      success: true,
      kind: "pdf",
      documentId: inserted.data.id
    };
  } catch (error) {
    logger.error("SolidWorks asset attach failed", { error });
    return data(
      { success: false, message: "Failed to attach asset" },
      { status: 500 }
    );
  }
}
