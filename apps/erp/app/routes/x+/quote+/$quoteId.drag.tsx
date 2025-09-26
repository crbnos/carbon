import { openai } from "@ai-sdk/openai";
import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { modelThumbnailTask } from "@carbon/jobs/trigger/model-thumbnail";
import { supportedModelTypes } from "@carbon/utils";
import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { generateObject } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { upsertPart } from "~/modules/items";
import {
  getQuote,
  upsertQuoteLine,
  upsertQuoteLineMethod,
} from "~/modules/sales";
import { path } from "~/utils/path";

const quoteDragValidator = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  path: z.string(),
  lineId: z.string().optional(),
});

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const formData = await request.formData();
  const payload = formData.get("payload");
  if (!payload || typeof payload !== "string") {
    throw new Error("Invalid payload");
  }

  const validation = quoteDragValidator.safeParse(JSON.parse(payload));
  if (!validation.success) {
    return json({ error: validation.error.flatten() }, { status: 400 });
  }

  const { name: fileName, path: documentPath, size, lineId } = validation.data;

  const serviceRole = getCarbonServiceRole();

  const quote = await getQuote(serviceRole, quoteId);
  if (quote.error || !quote.data) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(request, error(quote.error, "Failed to get quote details"))
    );
  }

  let targetLineId = lineId;
  let partId: string | undefined;
  const partName = fileName.replace(/\.[^/.]+$/, "");

  if (!targetLineId) {
    // Only create a new part and quote line if lineId is not provided
    // Extract filename without extension for the part name

    let readableId = partName;
    let revision = "0";
    try {
      const { object: parsedFilename } = await generateObject({
        // @ts-ignore
        model: openai("gpt-4o-mini"),
        schema: z.object({
          partId: z
            .string()
            .describe("The part identifier extracted from the filename"),
          revision: z
            .string()
            .nullable()
            .describe("The revision number if present, null if not found"),
        }),
        prompt: `Extract the part ID and revision from this filename: "${partName}". The part ID should be the main identifier, and revision should be any version/revision indicator if present.`,
      });

      readableId = parsedFilename.partId;
      revision = parsedFilename.revision || "0";
    } catch (error) {
      console.error(error);
    }

    let suffix = 1;

    // Check for uniqueness and append a suffix if necessary
    while (true) {
      const existingItem = await serviceRole
        .from("item")
        .select("id")
        .eq("readableId", readableId)
        .eq("revision", revision)
        .eq("companyId", companyId)
        .single();

      if (existingItem.error || !existingItem.data) {
        // readableId is unique, we can use it
        break;
      }

      // If not unique, append or increment suffix
      revision = `${revision} (${suffix})`;
      suffix++;
    }

    const partData = {
      id: readableId,
      name: readableId,
      defaultMethodType: "Make" as const,
      itemTrackingType: "Inventory" as const,
      replenishmentSystem: "Make" as const,
      revision,
      unitOfMeasureCode: "EA",
      companyId,
      createdBy: userId,
    };

    const part = await upsertPart(serviceRole, partData);
    if (part.error || !part.data?.id) {
      throw redirect(
        path.to.quote(quoteId),
        await flash(request, error(part.error, "Failed to create part"))
      );
    }

    partId = part.data?.id;

    const quoteLineData = {
      quoteId,
      itemId: partId ?? "",
      status: "Not Started" as const,
      estimatorId: userId,
      description: partName,
      methodType: "Make" as const,
      customerPartId: partName,
      customerPartRevision: "",
      unitOfMeasureCode: "EA",
      taxPercent: 0,
      quantity: [1],
      companyId,
      createdBy: userId,
    };

    const createQuotationLine = await upsertQuoteLine(
      serviceRole,
      quoteLineData
    );
    if (createQuotationLine.error || !createQuotationLine.data) {
      throw redirect(
        path.to.quote(quoteId),
        await flash(
          request,
          error(createQuotationLine.error, "Failed to create quote line.")
        )
      );
    }

    targetLineId = createQuotationLine.data.id;

    // Create quote line method for Make items
    const upsertMethod = await upsertQuoteLineMethod(serviceRole, {
      quoteId,
      quoteLineId: targetLineId,
      itemId: partId ?? "",
      configuration: undefined,
      companyId,
      userId,
    });

    if (upsertMethod.error) {
      throw redirect(
        path.to.quoteLine(quoteId, targetLineId),
        await flash(
          request,
          error(upsertMethod.error, "Failed to create quote line method.")
        )
      );
    }
  } else {
    const existingLine = await serviceRole
      .from("quoteLine")
      .select("itemId")
      .eq("id", targetLineId)
      .eq("companyId", companyId)
      .single();

    if (existingLine.error || !existingLine.data) {
      throw redirect(
        path.to.quote(quoteId),
        await flash(
          request,
          error(existingLine.error, "Failed to find quote line")
        )
      );
    }

    partId = existingLine.data.itemId;
  }

  const extension = fileName.split(".").pop();
  const is3DModel = extension && supportedModelTypes.includes(extension);
  let newPath = "";

  if (is3DModel) {
    const modelId = nanoid();
    const fileExtension = fileName.split(".").pop();
    newPath = `${companyId}/models/${modelId}.${fileExtension}`;

    // Create model record
    const modelRecord = await client.from("modelUpload").insert({
      id: modelId,
      modelPath: newPath,
      name: fileName,
      size: size ?? 0,
      companyId,
      createdBy: userId,
    });

    if (modelRecord.error) {
      console.error(
        `Failed to create model record for ${fileName}:`,
        modelRecord.error
      );
      return false;
    }

    // Link model to quote line and item (if partId exists)
    const updates = [
      client
        .from("quoteLine")
        .update({ modelUploadId: modelId })
        .eq("id", targetLineId),
    ];

    if (partId && modelId) {
      updates.push(
        // @ts-ignore
        client.from("item").update({ modelUploadId: modelId }).eq("id", partId)
      );
    }

    const [lineUpdate] = await Promise.all(updates);

    if (lineUpdate.error) {
      console.error(
        `Failed to link model to sales order line:`,
        lineUpdate.error
      );
    }

    // Move the file to the new path
    const move = await client.storage
      .from("private")
      .move(documentPath, newPath);

    if (move.error) {
      throw redirect(
        path.to.quote(quoteId),
        await flash(request, error(move.error, "Failed to move file"))
      );
    }

    await tasks.trigger<typeof modelThumbnailTask>("model-thumbnail", {
      companyId,
      modelId,
    });
  } else {
    newPath = `${companyId}/opportunity-line/${targetLineId}/${fileName}`;
    // Move the file to the new path
    const move = await client.storage
      .from("private")
      .move(documentPath, newPath);

    if (move.error) {
      throw redirect(
        path.to.quote(quoteId),
        await flash(request, error(move.error, "Failed to move file"))
      );
    }
  }

  return json({ success: true, quoteLineId: targetLineId });
}
