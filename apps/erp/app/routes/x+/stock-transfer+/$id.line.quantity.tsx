import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getStockTransfer } from "~/modules/inventory";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const { client: viewClient } = await requirePermissions(request, {
    view: "inventory"
  });
  const transfer = await getStockTransfer(viewClient, id);
  await requireUnlocked({
    request,
    isLocked: transfer.data?.status === "Completed",
    redirectTo: path.to.stockTransfer(id),
    message: "Cannot pick from a completed stock transfer."
  });

  const formData = await request.formData();

  const lineId = formData.get("id") as string;
  const pickedQuantity = parseInt(formData.get("quantity") as string, 10);
  const locationId = formData.get("locationId") as string;
  const trackedEntityId = formData.get("trackedEntityId") as string | undefined;

  if (!lineId || !Number.isFinite(pickedQuantity)) {
    return data(
      {
        success: false
      },
      await flash(request, error("Invalid form data", "Invalid form data"))
    );
  }

  const stockTransferLine = await client
    .from("stockTransferLine")
    .select("*")
    .eq("id", lineId)
    .single();

  if (!stockTransferLine.data) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error("Stock transfer line not found", "Stock transfer line not found")
      )
    );
  }

  let type = "inventory";
  if (pickedQuantity === 0) {
    if (stockTransferLine.data.requiresSerialTracking) {
      type = "unpickSerial";
    } else if (stockTransferLine.data.requiresBatchTracking) {
      type = "unpickBatch";
    } else {
      type = "unpickInventory";
    }
  }

  if (
    !trackedEntityId &&
    (stockTransferLine.data.requiresSerialTracking ||
      stockTransferLine.data.requiresBatchTracking)
  ) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error("Tracked entity not found", "Tracked entity not found")
      )
    );
  }

  // Call the post-stock-transfer function for inventory items
  const { data: transferResult, error: functionError } =
    await client.functions.invoke("post-stock-transfer", {
      body: JSON.stringify({
        type: type,
        stockTransferId: stockTransferLine.data.stockTransferId,
        stockTransferLineId: lineId,
        quantity: pickedQuantity,
        locationId: locationId,
        trackedEntityId: trackedEntityId,
        userId,
        companyId
      })
    });

  if (functionError) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error(
          functionError.message || "Failed to pick line",
          "Failed to pick line"
        )
      )
    );
  }

  if (transferResult?.splitEntityId) {
    try {
      await trigger("print-job", {
        sourceDocument: "Split",
        sourceDocumentId: transferResult.splitEntityId,
        companyId,
        userId,
        locationId: locationId || undefined
      });
      // Reprint the original batch too — its quantity changed in the split
      if (trackedEntityId) {
        await trigger("print-job", {
          sourceDocument: "Entity",
          sourceDocumentId: trackedEntityId,
          companyId,
          userId,
          locationId: locationId || undefined
        });
      }
    } catch (e) {
      console.error("Auto-print for split entity failed:", e);
    }
  }

  return data(
    {
      success: true
    },
    await flash(
      request,
      success(
        `${pickedQuantity} ${
          pickedQuantity === 1 ? "item" : "items"
        } marked as picked`
      )
    )
  );
}
