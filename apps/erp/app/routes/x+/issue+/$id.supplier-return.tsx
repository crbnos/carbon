import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getCompanyTimeZone } from "@carbon/database";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  deletePurchaseReturnOrder,
  insertPurchaseReturnOrder,
  setPurchaseReturnOrderLineTrackedEntities,
  upsertPurchaseReturnOrderLine
} from "~/modules/purchasing";
import { path } from "~/utils/path";

/**
 * Create Supplier Return: drafts a purchaseReturnOrder from an Issue's
 * 'Return to Supplier' disposition rows. Idempotent — quantities already
 * covered by a non-cancelled linked return are excluded; re-invoking with
 * nothing uncovered redirects to the newest linked draft. Ownership is
 * per-quantity: each nonConformancePurchaseReturnOrderLine association row
 * records the quantity it covers, which closeIssue subtracts from the
 * write-off.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "purchasing"
    });

  const { id } = params;
  if (!id) throw new Error("id is not found");

  const formData = await request.formData();
  const explicitSupplierId = (formData.get("supplierId") as string) || null;

  const [issue, itemRows, issueSuppliers, receiptLineAssociations, existing] =
    await Promise.all([
      client
        .from("nonConformance")
        .select("id, nonConformanceId, status, locationId")
        .eq("id", id)
        .eq("companyId", companyId)
        .single(),
      client
        .from("nonConformanceItem")
        .select(
          "id, itemId, quantity, disposition, links:nonConformanceItemTrackedEntity(trackedEntityId, quantity, trackedEntity(id, status, attributes))"
        )
        .eq("nonConformanceId", id)
        .eq("companyId", companyId)
        .order("createdAt", { ascending: true }),
      client
        .from("nonConformanceSupplier")
        .select("supplierId")
        .eq("nonConformanceId", id)
        .eq("companyId", companyId),
      client
        .from("nonConformanceReceiptLine")
        .select("receiptLineId, receiptId")
        .eq("nonConformanceId", id)
        .eq("companyId", companyId),
      client
        .from("nonConformancePurchaseReturnOrderLine")
        .select(
          "quantity, purchaseReturnOrderId, purchaseReturnOrderLine(itemId, purchaseReturnOrder(id, status))"
        )
        .eq("nonConformanceId", id)
        .eq("companyId", companyId)
    ]);

  if (issue.error) {
    throw redirect(
      path.to.issue(id),
      await flash(request, error(issue.error, "Failed to load issue"))
    );
  }
  if (issue.data.status === "Closed") {
    throw redirect(
      path.to.issue(id),
      await flash(request, error(null, "Issue is already closed"))
    );
  }

  const returnRows = (itemRows.data ?? []).filter(
    (row) => row.disposition === "Return to Supplier"
  );
  if (returnRows.length === 0) {
    throw redirect(
      path.to.issue(id),
      await flash(
        request,
        error(null, "No disposition rows are set to Return to Supplier")
      )
    );
  }

  // ── Supplier resolution: explicit choice → single associated supplier →
  // single supplier derived from the associated receipt lines' receipts.
  let supplierId = explicitSupplierId;
  if (!supplierId) {
    const associated = [
      ...new Set((issueSuppliers.data ?? []).map((s) => s.supplierId))
    ];
    if (associated.length === 1) {
      supplierId = associated[0];
    } else if (associated.length === 0) {
      const receiptIds = [
        ...new Set(
          (receiptLineAssociations.data ?? [])
            .map((r) => r.receiptId)
            .filter(Boolean) as string[]
        )
      ];
      if (receiptIds.length > 0) {
        const receipts = await client
          .from("receipt")
          .select("id, supplierId")
          .in("id", receiptIds)
          .eq("companyId", companyId);
        const derived = [
          ...new Set(
            (receipts.data ?? []).map((r) => r.supplierId).filter(Boolean)
          )
        ];
        if (derived.length === 1) supplierId = derived[0];
      }
    }
  }
  if (!supplierId) {
    throw redirect(
      path.to.issue(id),
      await flash(
        request,
        error(
          null,
          "Could not resolve a single supplier — select one explicitly"
        )
      )
    );
  }

  // ── Validate tracked-entity provenance against the resolved supplier.
  for (const row of returnRows) {
    for (const link of row.links ?? []) {
      const attributes = (link.trackedEntity?.attributes ?? {}) as Record<
        string,
        unknown
      >;
      const entitySupplier = attributes["Supplier"];
      if (entitySupplier && entitySupplier !== supplierId) {
        throw redirect(
          path.to.issue(id),
          await flash(
            request,
            error(
              null,
              `A tracked entity on item ${row.itemId} came from a different supplier`
            )
          )
        );
      }
    }
  }

  // ── Idempotent coverage: quantities already owned by non-cancelled linked
  // returns are excluded, allocated per item across rows in createdAt order.
  const nonCancelled = ((existing.data as any[]) ?? []).filter(
    (row) =>
      row.purchaseReturnOrderLine?.purchaseReturnOrder?.status !== "Cancelled"
  );
  const coverageByItem = new Map<string, number>();
  for (const row of nonCancelled) {
    const itemId = row.purchaseReturnOrderLine?.itemId;
    if (!itemId) continue;
    coverageByItem.set(
      itemId,
      (coverageByItem.get(itemId) ?? 0) + Number(row.quantity ?? 0)
    );
  }
  const coveredEntityIds = new Set<string>();
  {
    const linkedReturnIds = [
      ...new Set(
        nonCancelled
          .map((r) => r.purchaseReturnOrderId)
          .filter(Boolean) as string[]
      )
    ];
    if (linkedReturnIds.length > 0) {
      const lines = await client
        .from("purchaseReturnOrderLine")
        .select("id")
        .in("purchaseReturnOrderId", linkedReturnIds)
        .eq("companyId", companyId);
      const lineIds = (lines.data ?? []).map((l) => l.id);
      if (lineIds.length > 0) {
        const picks = await client
          .from("purchaseReturnOrderLineTrackedEntity")
          .select("trackedEntityId")
          .in("purchaseReturnOrderLineId", lineIds)
          .eq("companyId", companyId);
        for (const p of picks.data ?? [])
          coveredEntityIds.add(p.trackedEntityId);
      }
    }
  }

  const uncoveredRows: {
    row: (typeof returnRows)[number];
    quantity: number;
    entityIds: string[];
  }[] = [];
  for (const row of returnRows) {
    const coverage = coverageByItem.get(row.itemId) ?? 0;
    const rowQuantity = Number(row.quantity ?? 0);
    const offset = Math.min(rowQuantity, coverage);
    if (offset > 0) coverageByItem.set(row.itemId, coverage - offset);
    const uncovered = rowQuantity - offset;
    if (uncovered <= 0) continue;
    uncoveredRows.push({
      row,
      quantity: uncovered,
      entityIds: (row.links ?? [])
        .map((l) => l.trackedEntityId)
        .filter((entityId) => entityId && !coveredEntityIds.has(entityId))
    });
  }

  if (uncoveredRows.length === 0) {
    const openExisting = nonCancelled.find((r) =>
      ["Draft", "Confirmed", "Partially Shipped"].includes(
        r.purchaseReturnOrderLine?.purchaseReturnOrder?.status ?? ""
      )
    );
    const target =
      openExisting?.purchaseReturnOrderLine?.purchaseReturnOrder?.id;
    throw redirect(
      target ? path.to.purchaseReturnOrder(target) : path.to.issue(id),
      await flash(
        request,
        success(
          "Every Return to Supplier quantity is already covered by a linked return"
        )
      )
    );
  }

  // ── Resolve commercial linkage: receipt lines from this supplier for the
  // uncovered items (physical lineage) and their PO-line pricing.
  const receiptLineIds = [
    ...new Set(
      (receiptLineAssociations.data ?? [])
        .map((r) => r.receiptLineId)
        .filter(Boolean) as string[]
    )
  ];
  const receiptLinesById = new Map<
    string,
    { id: string; itemId: string | null; lineId: string | null }
  >();
  if (receiptLineIds.length > 0) {
    const receiptLines = await client
      .from("receiptLine")
      .select("id, itemId, lineId, receipt!inner(supplierId)")
      .in("id", receiptLineIds)
      .eq("companyId", companyId)
      .eq("receipt.supplierId", supplierId);
    for (const line of receiptLines.data ?? []) {
      receiptLinesById.set(line.id, line);
    }
  }
  const receiptLineByItem = new Map<
    string,
    { id: string; lineId: string | null }
  >();
  for (const line of receiptLinesById.values()) {
    if (line.itemId && !receiptLineByItem.has(line.itemId)) {
      receiptLineByItem.set(line.itemId, { id: line.id, lineId: line.lineId });
    }
  }
  const poLineIds = [
    ...new Set(
      [...receiptLineByItem.values()]
        .map((l) => l.lineId)
        .filter(Boolean) as string[]
    )
  ];
  const poLineById = new Map<
    string,
    { unitPrice: number; conversionFactor: number }
  >();
  if (poLineIds.length > 0) {
    const poLines = await client
      .from("purchaseOrderLine")
      .select("id, unitPrice, conversionFactor")
      .in("id", poLineIds)
      .eq("companyId", companyId);
    for (const line of poLines.data ?? []) {
      poLineById.set(line.id, {
        unitPrice: Number(line.unitPrice ?? 0),
        conversionFactor: Number(line.conversionFactor ?? 1)
      });
    }
  }

  // ── Create the draft return + lines + picks + per-quantity ownership rows.
  const serviceRole = getCarbonServiceRole();
  const orderDate = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();

  const returnOrder = await insertPurchaseReturnOrder(client, {
    supplierId,
    companyId,
    companyGroupId,
    createdBy: userId,
    orderDate,
    locationId: issue.data.locationId ?? undefined
  });
  if (returnOrder.error || !returnOrder.data) {
    throw redirect(
      path.to.issue(id),
      await flash(
        request,
        error(returnOrder.error, "Failed to create supplier return")
      )
    );
  }
  const purchaseReturnOrderId = returnOrder.data.id;
  const purchaseReturnOrderReadableId = returnOrder.data.purchaseReturnOrderId;

  for (const { row, quantity, entityIds } of uncoveredRows) {
    const receiptLine = receiptLineByItem.get(row.itemId);
    const poLine = receiptLine?.lineId
      ? poLineById.get(receiptLine.lineId)
      : null;
    const unitPrice = poLine
      ? poLine.unitPrice / (poLine.conversionFactor || 1)
      : 0;

    const line = await upsertPurchaseReturnOrderLine(client, {
      purchaseReturnOrderId,
      itemId: row.itemId,
      quantity,
      unitPrice,
      receiptLineId: receiptLine?.id,
      purchaseOrderLineId: receiptLine?.lineId ?? undefined,
      companyId,
      createdBy: userId
    });
    if (line.error || !line.data) {
      await deletePurchaseReturnOrder(client, purchaseReturnOrderId);
      throw redirect(
        path.to.issue(id),
        await flash(request, error(line.error, "Failed to create return line"))
      );
    }

    if (entityIds.length > 0) {
      const picks = await setPurchaseReturnOrderLineTrackedEntities(
        client,
        line.data.id,
        companyId,
        entityIds,
        userId
      );
      if (picks.error) {
        await deletePurchaseReturnOrder(client, purchaseReturnOrderId);
        throw redirect(
          path.to.issue(id),
          await flash(
            request,
            error(picks.error, "Failed to assign tracked entities")
          )
        );
      }
    }

    // Per-quantity ownership: this association row covers `quantity` of the
    // issue's write-off pool (closeIssue subtracts shipped coverage).
    const association = await serviceRole
      .from("nonConformancePurchaseReturnOrderLine")
      .insert({
        nonConformanceId: id,
        purchaseReturnOrderLineId: line.data.id,
        purchaseReturnOrderId,
        purchaseReturnOrderReadableId,
        quantity,
        companyId,
        createdBy: userId
      });
    if (association.error) {
      await deletePurchaseReturnOrder(client, purchaseReturnOrderId);
      throw redirect(
        path.to.issue(id),
        await flash(
          request,
          error(association.error, "Failed to link the supplier return")
        )
      );
    }
  }

  throw redirect(
    path.to.purchaseReturnOrder(purchaseReturnOrderId),
    await flash(request, success("Supplier return drafted"))
  );
}
