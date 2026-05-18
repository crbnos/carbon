import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { salesRfqDragValidator, upsertSalesRFQLine } from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { rfqId } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }

  const formData = await request.formData();
  const payload = (formData.get("payload") as string) ?? "{}";
  const validation = salesRfqDragValidator.safeParse(JSON.parse(payload));

  if (!validation.success) {
    return {
      error: validation.error.message
    };
  }

  const {
    customerPartId,
    is3DModel,
    lineId,
    path: documentPath,
    size,
    salesRfqId
  } = validation.data;

  let targetLineId = lineId;

  if (!targetLineId) {
    // we are creating a new line
    let data = {
      salesRfqId,
      customerPartId,
      quantity: [1],
      unitOfMeasureCode: "EA",
      order: 1
    };
    const insertLine = await upsertSalesRFQLine({
      ...data,
      description: "",
      companyId,
      createdBy: userId,
      customFields: setCustomFields(formData)
    });
    if (insertLine.error) {
      throw redirect(
        path.to.salesRfqDetails(rfqId),
        await flash(
          request,
          error(insertLine.error, "Failed to insert RFQ line")
        )
      );
    }

    targetLineId = insertLine.data?.id;
    if (!targetLineId) {
      throw redirect(
        path.to.salesRfqDetails(rfqId),
        await flash(request, error(insertLine, "Failed to insert RFQ line"))
      );
    }
  }

  const fileName = documentPath.split("/").pop();
  let newPath = "";
  if (is3DModel) {
    const modelId = nanoid();
    const fileExtension = fileName?.split(".").pop();
    newPath = `${companyId}/models/${modelId}.${fileExtension}`;

    const [recordUpdate, recordCreate] = await Promise.all([
      client
        .from("salesRfqLine")
        .update({ modelUploadId: modelId })
        .eq("id", targetLineId),
      client.from("modelUpload").insert({
        id: modelId,
        modelPath: newPath,
        name: fileName!,
        size: size ?? 0,
        companyId,
        createdBy: userId
      })
    ]);

    if (recordUpdate.error) {
      throw redirect(
        path.to.salesRfqDetails(rfqId),
        await flash(
          request,
          error(recordUpdate.error, "Failed to update RFQ line with model")
        )
      );
    }

    if (recordCreate.error) {
      throw redirect(
        path.to.salesRfqDetails(rfqId),
        await flash(
          request,
          error(recordCreate.error, "Failed to insert model record")
        )
      );
    }

    // Move the file to the new path
    const move = await client.storage
      .from("private")
      .move(documentPath, newPath);

    if (move.error) {
      throw redirect(
        path.to.salesRfqDetails(rfqId),
        await flash(request, error(move.error, "Failed to move file"))
      );
    }

    await trigger("model-thumbnail", {
      companyId,
      modelId
    });
  } else {
    newPath = `${companyId}/opportunity-line/${targetLineId}/${fileName}`;
    // Move the file to the new path
    const move = await client.storage
      .from("private")
      .move(documentPath, newPath);

    if (move.error) {
      throw redirect(
        path.to.salesRfqDetails(rfqId),
        await flash(request, error(move.error, "Failed to move file"))
      );
    }
  }

  return { success: true };
}
