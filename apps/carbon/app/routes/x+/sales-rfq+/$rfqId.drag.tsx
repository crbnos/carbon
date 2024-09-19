import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import { nanoid } from "nanoid";
import { triggerClient } from "~/lib/trigger.server";
import { salesRfqDragValidator, upsertSalesRFQLine } from "~/modules/sales";
import { upsertModelUpload } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { rfqId } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }

  const formData = await request.formData();
  const payload = (formData.get("payload") as string) ?? "{}";
  const validation = salesRfqDragValidator.safeParse(JSON.parse(payload));

  if (!validation.success) {
    return json({
      error: validation.error.message,
    });
  }

  const {
    customerPartId,
    is3DModel,
    lineId,
    path: documentPath,
    salesRfqId,
  } = validation.data;

  let targetLineId = lineId;

  if (!targetLineId) {
    // we are creating a new line
    let data = {
      salesRfqId,
      customerPartId,
      quantity: [1],
      unitOfMeasureCode: "EA",
      order: 1,
    };
    const insertLine = await upsertSalesRFQLine(client, {
      ...data,
      companyId,
      createdBy: userId,
      customFields: setCustomFields(formData),
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
    const fileId = nanoid();
    const fileExtension = fileName?.split(".").pop();
    newPath = `${companyId}/models/${fileId}.${fileExtension}`;

    const [recordUpdate, recordCreate] = await Promise.all([
      client
        .from("salesRfqLine")
        .update({ modelUploadId: fileId })
        .eq("id", targetLineId),
      upsertModelUpload(client, {
        id: fileId,
        modelPath: newPath,
        companyId,
        createdBy: userId,
      }),
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
    await triggerClient.sendEvent({
      name: "autodesk.upload",
      payload: {
        companyId,
        fileId,
        itemId: null,
        modelPath: newPath,
        name: fileName,
        quoteLineId: null,
        salesRfqLineId: targetLineId,
        userId,
      },
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

  throw redirect(path.to.salesRfqDetails(rfqId));
}
