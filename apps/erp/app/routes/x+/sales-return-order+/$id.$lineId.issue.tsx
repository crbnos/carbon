import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { datetime } from "@carbon/utils";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteIssue, getIssueTypesList, insertIssue } from "~/modules/quality";
import {
  getSalesReturnOrder,
  getSalesReturnOrderLine,
  getSalesReturnOrderLineTrackedEntities,
  setSalesReturnOrderLineDisposition
} from "~/modules/sales";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import { getUserDefaults } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

// Escalate an RMA line to a quality Issue (NCR). Scrap and Rework are quality
// decisions, so instead of writing the disposition directly, this creates an
// Issue pre-associated with the line and its returned entities (the
// inspection-reject precedent), then records the disposition on the line.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality",
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("Could not find id");
  if (!lineId) throw notFound("Could not find lineId");

  const redirectTo =
    requestReferrer(request) ?? path.to.salesReturnOrderLine(id, lineId);

  const failWith = async (err: unknown, message: string): Promise<Response> => {
    return redirect(redirectTo, await flash(request, error(err, message)));
  };

  const formData = await request.formData();
  const disposition = formData.get("disposition");
  if (disposition !== "Scrap" && disposition !== "Rework") {
    throw await failWith(
      null,
      "Only Scrap and Rework dispositions escalate to an Issue"
    );
  }

  const [salesReturnOrder, line] = await Promise.all([
    getSalesReturnOrder(client, id),
    getSalesReturnOrderLine(client, lineId)
  ]);

  if (salesReturnOrder.error || !salesReturnOrder.data) {
    throw await failWith(salesReturnOrder.error, "Failed to load return order");
  }
  if (line.error || !line.data) {
    throw await failWith(line.error, "Failed to load return order line");
  }
  if (
    line.data.salesReturnOrderId !== id ||
    salesReturnOrder.data.companyId !== companyId
  ) {
    throw await failWith(
      null,
      "This line does not belong to this return order"
    );
  }

  const quantityReceived = Number(line.data.quantityReceived ?? 0);
  if (quantityReceived <= 0) {
    throw await failWith(
      null,
      "Cannot set a disposition before any quantity is received"
    );
  }

  // The line's returned entities: expected serials/batches still On Hold...
  const linked = await getSalesReturnOrderLineTrackedEntities(client, [lineId]);
  const linkedOnHoldIds = (linked.data ?? [])
    .filter((row) => row.trackedEntity?.status === "On Hold")
    .map((row) => row.trackedEntityId);

  // ...plus blind returns: On Hold entities created at receipt against this
  // line's receipt lines with no expected-entity row.
  const receipts = await client
    .from("receipt")
    .select("id")
    .eq("sourceDocument", "Sales Return Order")
    .eq("sourceDocumentId", id)
    .eq("companyId", companyId);
  let blindOnHoldIds: string[] = [];
  const receiptIds = (receipts.data ?? []).map((receipt) => receipt.id);
  if (receiptIds.length > 0) {
    const receiptLines = await client
      .from("receiptLine")
      .select("id")
      .in("receiptId", receiptIds)
      .eq("lineId", lineId)
      .eq("companyId", companyId);
    const receiptLineIds = (receiptLines.data ?? []).map((row) => row.id);
    if (receiptLineIds.length > 0) {
      const blind = await client
        .from("trackedEntity")
        .select("id")
        .eq("companyId", companyId)
        .eq("status", "On Hold")
        .in("attributes ->> Receipt Line", receiptLineIds);
      blindOnHoldIds = (blind.data ?? []).map((entity) => entity.id);
    }
  }
  const entityIds = Array.from(
    new Set([...linkedOnHoldIds, ...blindOnHoldIds])
  );

  const serviceRole = getCarbonServiceRole();

  const [userDefaults, issueTypes, item, returnReason] = await Promise.all([
    getUserDefaults(client, userId, companyId),
    getIssueTypesList(client, companyId),
    client
      .from("item")
      .select("readableIdWithRevision")
      .eq("id", line.data.itemId)
      .eq("companyId", companyId)
      .single(),
    line.data.returnReasonId
      ? client
          .from("returnReason")
          .select("name")
          .eq("id", line.data.returnReasonId)
          .single()
      : Promise.resolve({ data: null, error: null })
  ]);

  const issueType = issueTypes.data?.[0];
  const locationId =
    salesReturnOrder.data.locationId ?? userDefaults.data?.locationId ?? null;

  if (!issueType || !locationId) {
    throw await failWith(
      null,
      "Configure at least one Issue Type and a location to escalate this line to an Issue"
    );
  }

  const rmaReadableId = salesReturnOrder.data.salesReturnOrderId ?? "";
  const itemReadableId = item.data?.readableIdWithRevision ?? line.data.itemId;
  const returnReasonName = returnReason.data?.name ?? null;

  const issueTitle = [
    "Returned goods",
    rmaReadableId,
    itemReadableId && `— ${itemReadableId}`
  ]
    .filter(Boolean)
    .join(" ");

  const issueDescription = [
    `Auto-created from sales return order ${rmaReadableId} line ${line.data.lineNumber}.`,
    `Requested disposition: ${disposition}.`,
    returnReasonName ? `Return reason: ${returnReasonName}.` : null
  ]
    .filter(Boolean)
    .join(" ");

  const createResult = await insertIssue(serviceRole, {
    name: issueTitle,
    description: issueDescription,
    priority: "Medium",
    source: "Internal",
    locationId,
    nonConformanceTypeId: issueType.id,
    openDate: datetime
      .today(await getLocationTimeZone(client, locationId, companyId))
      .toString(),
    quantity: quantityReceived,
    items: [line.data.itemId],
    companyId,
    createdBy: userId
  });

  if (createResult.error || !createResult.data) {
    throw await failWith(createResult.error, "Failed to create Issue");
  }

  const ncrId = createResult.data.id;

  // insertIssue seeded a nonConformanceItem row with default qty and Pending
  // disposition. Overwrite with the line's received quantity and the requested
  // disposition so MRB starts from the escalation's context.
  const itemUpdate = await serviceRole
    .from("nonConformanceItem")
    .update({
      quantity: quantityReceived,
      disposition,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("nonConformanceId", ncrId)
    .eq("itemId", line.data.itemId);
  if (itemUpdate.error) {
    throw await failWith(itemUpdate.error, "Failed to set the Issue's item");
  }

  const itemRow = await serviceRole
    .from("nonConformanceItem")
    .select("id")
    .eq("nonConformanceId", ncrId)
    .eq("itemId", line.data.itemId)
    .single();
  const nonConformanceItemId = itemRow.data?.id ?? null;

  // Link the RMA line so the issue explorer can surface the origin and
  // deep-link back to the return order.
  const lineLink = await serviceRole
    .from("nonConformanceSalesReturnOrderLine")
    .insert({
      nonConformanceId: ncrId,
      salesReturnOrderLineId: lineId,
      salesReturnOrderId: id,
      salesReturnOrderReadableId: rmaReadableId,
      companyId,
      createdBy: userId
    });
  if (lineLink.error) {
    throw await failWith(lineLink.error, "Failed to link the Issue to the RMA");
  }

  // Link the line's returned entities to the NCR, and seed the per-row entity
  // links on the item row so MRB can split / reassign specific entities.
  if (entityIds.length > 0) {
    const entityLinks = await serviceRole
      .from("nonConformanceTrackedEntity")
      .insert(
        entityIds.map((trackedEntityId) => ({
          nonConformanceId: ncrId,
          trackedEntityId,
          companyId,
          createdBy: userId
        }))
      );
    if (entityLinks.error) {
      throw await failWith(
        entityLinks.error,
        "Failed to link the returned entities to the Issue"
      );
    }

    if (nonConformanceItemId) {
      const entityQuantities = await serviceRole
        .from("trackedEntity")
        .select("id, quantity")
        .in("id", entityIds)
        .eq("companyId", companyId);
      const rows = (entityQuantities.data ?? []).map((entity) => ({
        nonConformanceItemId,
        nonConformanceId: ncrId,
        trackedEntityId: entity.id,
        quantity: Number(entity.quantity ?? 1),
        companyId,
        createdBy: userId
      }));
      if (rows.length > 0) {
        await serviceRole.from("nonConformanceItemTrackedEntity").insert(rows);
      }
    }
  }

  const tasks = await serviceRole.functions.invoke("create", {
    body: {
      type: "nonConformanceTasks",
      id: ncrId,
      companyId,
      userId
    },
    region: FunctionRegion.UsEast1
  });
  if (tasks.error) {
    await deleteIssue(serviceRole, ncrId);
    throw await failWith(tasks.error, "Failed to create Issue tasks");
  }

  const dispositionResult = await setSalesReturnOrderLineDisposition(
    client,
    getDatabaseClient(),
    {
      lineId,
      companyId,
      disposition,
      userId
    }
  );
  if (dispositionResult.error) {
    throw redirect(
      path.to.issue(ncrId),
      await flash(
        request,
        error(
          dispositionResult.error,
          "Issue created, but failed to update the line's disposition"
        )
      )
    );
  }

  throw redirect(
    path.to.issue(ncrId),
    await flash(request, success("Issue created for return line"))
  );
}
