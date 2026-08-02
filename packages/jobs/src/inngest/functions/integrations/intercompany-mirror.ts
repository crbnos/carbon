/**
 * Intercompany document mirroring.
 *
 * When a purchase order on a supplier with `intercompanyCompanyId` set is
 * released (leaves Draft) and the source company's group has
 * `companyGroup.intercompanyDocumentMirroring = true`, we draft a matching
 * salesOrder in the partner company for the auto-synced intercompany customer,
 * copy the mappable lines, and record an `intercompanyDocumentLink`.
 *
 * Symmetrically, when a sales invoice to an intercompany customer is posted, we
 * draft the matching purchaseInvoice in the buyer company.
 *
 * Design notes:
 * - Mirrored documents always stay in Draft — this is a one-way sync from the
 *   originating document; the mirror never triggers a reverse mirror (loop
 *   guard). The `intercompanyDocumentLink` row is both the audit trail and the
 *   idempotency key (unique on sourceDocumentType + sourceDocumentId +
 *   sourceCompanyId), so a re-fire skips instead of duplicating.
 * - Line items are resolved across the company boundary through
 *   `intercompanyItemLink`. If ANY item-bearing line has no mapping the whole
 *   mirror fails (Failed link, no partial document) — never a silent wrong item.
 * - This lives in @carbon/jobs, which cannot import the ERP app's service
 *   functions (insertSalesOrder / insertPurchaseInvoice live in apps/erp and the
 *   app depends on this package, not the reverse). The inserts below therefore
 *   replicate the essential shape of those helpers against the service-role
 *   Supabase client.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { inngest } from "../../client";

type Client = SupabaseClient<Database>;

// Line types that carry an item and can be mirrored 1:1 across companies.
// (Comment lines are handled separately; G/L Account and Fixed Asset lines
// reference company-specific accounts/assets and are skipped.)
const MIRRORABLE_ITEM_TYPES = [
  "Part",
  "Material",
  "Tool",
  "Service",
  "Consumable",
  "Fixture"
] as const;

const MirrorPoPayloadSchema = z.object({
  purchaseOrderId: z.string(),
  sourceCompanyId: z.string(),
  targetCompanyId: z.string(),
  companyGroupId: z.string(),
  userId: z.string()
});

const MirrorInvoicePayloadSchema = z.object({
  salesInvoiceId: z.string(),
  sourceCompanyId: z.string(),
  targetCompanyId: z.string(),
  companyGroupId: z.string(),
  userId: z.string()
});

// ============================================================
// Shared helpers
// ============================================================

/** Insert or update the mirror link, keyed on the source document. */
async function upsertLink(
  client: Client,
  base: {
    companyGroupId: string;
    sourceCompanyId: string;
    targetCompanyId: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    targetDocumentType: string;
  },
  patch: {
    status: "Mirrored" | "Failed" | "Exception";
    targetDocumentId?: string | null;
    failureReason?: string | null;
    lastSyncedAt?: string | null;
  }
) {
  return client
    .from("intercompanyDocumentLink")
    .upsert(
      {
        ...base,
        status: patch.status,
        targetDocumentId: patch.targetDocumentId ?? null,
        failureReason: patch.failureReason ?? null,
        lastSyncedAt: patch.lastSyncedAt ?? null,
        updatedAt: new Date().toISOString()
      },
      { onConflict: "sourceDocumentType,sourceDocumentId,sourceCompanyId" }
    )
    .select("id")
    .single();
}

/** Resolve the users in a company who hold `accounting_create`. */
async function getAccountingOwnerUserIds(
  client: Client,
  companyId: string
): Promise<string[]> {
  const employees = await client
    .from("employee")
    .select("id")
    .eq("companyId", companyId)
    .eq("active", true);

  const ids = (employees.data ?? []).map((e) => e.id);
  if (ids.length === 0) return [];

  const perms = await client
    .from("userPermission")
    .select("id, permissions")
    .in("id", ids);

  const owners: string[] = [];
  for (const p of perms.data ?? []) {
    const permissions = (p.permissions ?? {}) as Record<string, unknown>;
    const acct = permissions.accounting_create;
    if (
      Array.isArray(acct) &&
      (acct.includes(companyId) || acct.includes("0"))
    ) {
      owners.push(p.id);
    }
  }
  return owners;
}

/** Best-effort notification to the target company's accounting owners. */
async function notifyAccountingOwners(
  client: Client,
  companyId: string,
  documentId: string,
  event: NotificationEvent
) {
  try {
    const userIds = await getAccountingOwnerUserIds(client, companyId);
    if (userIds.length === 0) return;
    await inngest.send({
      name: "carbon/notify",
      data: {
        companyId,
        documentId,
        event,
        recipient: { type: "users", userIds }
      }
    });
  } catch {
    // Notifications are best-effort — never fail the mirror over a notify error.
  }
}

/** Resolve the first location of a company (for line locationId defaults). */
async function getDefaultLocationId(
  client: Client,
  companyId: string
): Promise<string | null> {
  const location = await client
    .from("location")
    .select("id")
    .eq("companyId", companyId)
    .order("name")
    .limit(1)
    .maybeSingle();
  return location.data?.id ?? null;
}

// ============================================================
// PO -> SO
// ============================================================

async function mirrorPurchaseOrder(
  payload: z.infer<typeof MirrorPoPayloadSchema>
) {
  const client = getCarbonServiceRole();
  const {
    purchaseOrderId,
    sourceCompanyId,
    targetCompanyId,
    companyGroupId,
    userId
  } = payload;

  const base = {
    companyGroupId,
    sourceCompanyId,
    targetCompanyId,
    sourceDocumentType: "purchaseOrder",
    sourceDocumentId: purchaseOrderId,
    targetDocumentType: "salesOrder"
  };

  // Idempotency: a completed mirror already exists.
  const existing = await client
    .from("intercompanyDocumentLink")
    .select("id, status")
    .eq("sourceDocumentType", "purchaseOrder")
    .eq("sourceDocumentId", purchaseOrderId)
    .eq("sourceCompanyId", sourceCompanyId)
    .maybeSingle();
  if (existing.data?.status === "Mirrored") {
    return { skipped: "already-mirrored" as const };
  }

  // Loop guard: a mirrored target never initiates a reverse mirror.
  const asTarget = await client
    .from("intercompanyDocumentLink")
    .select("id")
    .eq("targetDocumentId", purchaseOrderId)
    .eq("targetCompanyId", sourceCompanyId)
    .maybeSingle();
  if (asTarget.data) return { skipped: "is-mirror-target" as const };

  try {
    // Reload the source PO and re-validate the intercompany conditions.
    const po = await client
      .from("purchaseOrder")
      .select("supplierId, companyId, currencyCode")
      .eq("id", purchaseOrderId)
      .eq("companyId", sourceCompanyId)
      .single();
    if (po.error || !po.data) return { skipped: "po-not-found" as const };

    const supplier = await client
      .from("supplier")
      .select("intercompanyCompanyId")
      .eq("id", po.data.supplierId)
      .single();
    if (supplier.data?.intercompanyCompanyId !== targetCompanyId) {
      return { skipped: "supplier-not-intercompany" as const };
    }

    const group = await client
      .from("companyGroup")
      .select("intercompanyDocumentMirroring")
      .eq("id", companyGroupId)
      .single();
    if (!group.data?.intercompanyDocumentMirroring) {
      return { skipped: "mirroring-disabled" as const };
    }

    // Resolve the intercompany customer in the partner company.
    const customer = await client
      .from("customer")
      .select("id")
      .eq("companyId", targetCompanyId)
      .eq("intercompanyCompanyId", sourceCompanyId)
      .maybeSingle();
    if (!customer.data) {
      const failed = await upsertLink(client, base, {
        status: "Failed",
        failureReason:
          "No intercompany customer configured in the partner company"
      });
      if (failed.data) {
        await notifyAccountingOwners(
          client,
          targetCompanyId,
          failed.data.id,
          NotificationEvent.SalesOrderAssignment
        );
      }
      return { failed: "no-ic-customer" as const };
    }

    // Load lines and map every item-bearing line across the boundary.
    const lines = await client
      .from("purchaseOrderLine")
      .select(
        "itemId, purchaseOrderLineType, purchaseQuantity, purchaseUnitOfMeasureCode, unitPrice, promisedDate, description"
      )
      .eq("purchaseOrderId", purchaseOrderId)
      .eq("companyId", sourceCompanyId);

    const poLines = lines.data ?? [];
    const itemLines = poLines.filter((l) => !!l.itemId);
    const sourceItemIds = Array.from(
      new Set(itemLines.map((l) => l.itemId as string))
    );

    let mapById = new Map<string, string>();
    if (sourceItemIds.length > 0) {
      const maps = await client
        .from("intercompanyItemLink")
        .select("sourceItemId, targetItemId")
        .eq("targetCompanyId", targetCompanyId)
        .in("sourceItemId", sourceItemIds);
      mapById = new Map(
        (maps.data ?? []).map((m) => [m.sourceItemId, m.targetItemId])
      );
    }

    const unmapped = sourceItemIds.filter((id) => !mapById.has(id));
    if (unmapped.length > 0) {
      const failed = await upsertLink(client, base, {
        status: "Failed",
        failureReason: `Unmapped item(s) for the partner company: ${unmapped.join(", ")}`
      });
      if (failed.data) {
        await notifyAccountingOwners(
          client,
          targetCompanyId,
          failed.data.id,
          NotificationEvent.SalesOrderAssignment
        );
      }
      return { failed: "unmapped-items" as const, unmapped };
    }

    // Create the Draft sales order in the partner company.
    const currencyCode = po.data.currencyCode ?? undefined;
    const targetLocationId = await getDefaultLocationId(
      client,
      targetCompanyId
    );

    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "salesOrder",
      company_id: targetCompanyId
    });
    if (seq.error || !seq.data) {
      throw new Error(seq.error?.message ?? "Failed to generate SO sequence");
    }

    const opportunity = await client
      .from("opportunity")
      .insert({ companyId: targetCompanyId, customerId: customer.data.id })
      .select("id")
      .single();
    if (opportunity.error) throw new Error(opportunity.error.message);

    const now = new Date().toISOString();
    const order = await client
      .from("salesOrder")
      .insert({
        salesOrderId: seq.data,
        customerId: customer.data.id,
        opportunityId: opportunity.data.id,
        status: "Draft",
        orderDate: now.split("T")[0],
        currencyCode: currencyCode ?? "USD",
        exchangeRate: 1,
        exchangeRateUpdatedAt: now,
        locationId: targetLocationId,
        companyId: targetCompanyId,
        createdBy: userId,
        updatedBy: userId
      })
      .select("id")
      .single();
    if (order.error) throw new Error(order.error.message);

    const salesOrderId = order.data.id;

    let sortOrder = 1;
    for (const line of poLines) {
      const isComment = line.purchaseOrderLineType === "Comment";
      const isItem =
        !!line.itemId &&
        (MIRRORABLE_ITEM_TYPES as readonly string[]).includes(
          line.purchaseOrderLineType
        );
      if (!isComment && !isItem) continue; // skip G/L Account / Fixed Asset

      const insertLine = await client.from("salesOrderLine").insert({
        salesOrderId,
        salesOrderLineType:
          line.purchaseOrderLineType as Database["public"]["Enums"]["salesOrderLineType"],
        itemId: isItem ? mapById.get(line.itemId as string) : null,
        // methodType is NOT NULL; supply the column default explicitly (Comment
        // lines have no method but the column still requires a value).
        methodType: "Pull from Inventory",
        description: line.description ?? null,
        saleQuantity: line.purchaseQuantity ?? 0,
        unitOfMeasureCode: line.purchaseUnitOfMeasureCode ?? null,
        unitPrice: line.unitPrice ?? 0,
        promisedDate: line.promisedDate ?? null,
        locationId: targetLocationId,
        exchangeRate: 1,
        sortOrder: sortOrder++,
        companyId: targetCompanyId,
        createdBy: userId,
        updatedBy: userId
      });
      if (insertLine.error) throw new Error(insertLine.error.message);
    }

    const linked = await upsertLink(client, base, {
      status: "Mirrored",
      targetDocumentId: salesOrderId,
      lastSyncedAt: now
    });
    if (linked.error) throw new Error(linked.error.message);

    await notifyAccountingOwners(
      client,
      targetCompanyId,
      salesOrderId,
      NotificationEvent.SalesOrderAssignment
    );

    return { mirrored: salesOrderId };
  } catch (err) {
    // Best-effort: record the failure instead of leaving the link Pending.
    await upsertLink(client, base, {
      status: "Exception",
      failureReason: (err as Error).message
    }).catch(() => {
      // Best-effort — swallow secondary failures recording the Exception.
    });
    return { error: (err as Error).message };
  }
}

// ============================================================
// Sales invoice -> Purchase invoice
// ============================================================

async function mirrorSalesInvoice(
  payload: z.infer<typeof MirrorInvoicePayloadSchema>
) {
  const client = getCarbonServiceRole();
  const {
    salesInvoiceId,
    sourceCompanyId,
    targetCompanyId,
    companyGroupId,
    userId
  } = payload;

  const base = {
    companyGroupId,
    sourceCompanyId,
    targetCompanyId,
    sourceDocumentType: "salesInvoice",
    sourceDocumentId: salesInvoiceId,
    targetDocumentType: "purchaseInvoice"
  };

  const existing = await client
    .from("intercompanyDocumentLink")
    .select("id, status")
    .eq("sourceDocumentType", "salesInvoice")
    .eq("sourceDocumentId", salesInvoiceId)
    .eq("sourceCompanyId", sourceCompanyId)
    .maybeSingle();
  if (existing.data?.status === "Mirrored") {
    return { skipped: "already-mirrored" as const };
  }

  const asTarget = await client
    .from("intercompanyDocumentLink")
    .select("id")
    .eq("targetDocumentId", salesInvoiceId)
    .eq("targetCompanyId", sourceCompanyId)
    .maybeSingle();
  if (asTarget.data) return { skipped: "is-mirror-target" as const };

  try {
    const invoice = await client
      .from("salesInvoice")
      .select("customerId, companyId, currencyCode")
      .eq("id", salesInvoiceId)
      .eq("companyId", sourceCompanyId)
      .single();
    if (invoice.error || !invoice.data) {
      return { skipped: "invoice-not-found" as const };
    }

    const customer = await client
      .from("customer")
      .select("intercompanyCompanyId")
      .eq("id", invoice.data.customerId)
      .single();
    if (customer.data?.intercompanyCompanyId !== targetCompanyId) {
      return { skipped: "customer-not-intercompany" as const };
    }

    const group = await client
      .from("companyGroup")
      .select("intercompanyDocumentMirroring")
      .eq("id", companyGroupId)
      .single();
    if (!group.data?.intercompanyDocumentMirroring) {
      return { skipped: "mirroring-disabled" as const };
    }

    // Resolve the intercompany supplier in the buyer company.
    const supplier = await client
      .from("supplier")
      .select("id")
      .eq("companyId", targetCompanyId)
      .eq("intercompanyCompanyId", sourceCompanyId)
      .maybeSingle();
    if (!supplier.data) {
      const failed = await upsertLink(client, base, {
        status: "Failed",
        failureReason:
          "No intercompany supplier configured in the buyer company"
      });
      if (failed.data) {
        await notifyAccountingOwners(
          client,
          targetCompanyId,
          failed.data.id,
          NotificationEvent.PurchaseInvoiceAssignment
        );
      }
      return { failed: "no-ic-supplier" as const };
    }

    const lines = await client
      .from("salesInvoiceLine")
      .select(
        "itemId, invoiceLineType, quantity, unitOfMeasureCode, unitPrice, description"
      )
      .eq("invoiceId", salesInvoiceId)
      .eq("companyId", sourceCompanyId);

    const invoiceLines = lines.data ?? [];
    const itemLines = invoiceLines.filter((l) => !!l.itemId);
    const sourceItemIds = Array.from(
      new Set(itemLines.map((l) => l.itemId as string))
    );

    let mapById = new Map<string, string>();
    if (sourceItemIds.length > 0) {
      const maps = await client
        .from("intercompanyItemLink")
        .select("sourceItemId, targetItemId")
        .eq("targetCompanyId", targetCompanyId)
        .in("sourceItemId", sourceItemIds);
      mapById = new Map(
        (maps.data ?? []).map((m) => [m.sourceItemId, m.targetItemId])
      );
    }

    const unmapped = sourceItemIds.filter((id) => !mapById.has(id));
    if (unmapped.length > 0) {
      const failed = await upsertLink(client, base, {
        status: "Failed",
        failureReason: `Unmapped item(s) for the buyer company: ${unmapped.join(", ")}`
      });
      if (failed.data) {
        await notifyAccountingOwners(
          client,
          targetCompanyId,
          failed.data.id,
          NotificationEvent.PurchaseInvoiceAssignment
        );
      }
      return { failed: "unmapped-items" as const, unmapped };
    }

    const currencyCode = invoice.data.currencyCode ?? "USD";
    const targetLocationId = await getDefaultLocationId(
      client,
      targetCompanyId
    );

    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "purchaseInvoice",
      company_id: targetCompanyId
    });
    if (seq.error || !seq.data) {
      throw new Error(
        seq.error?.message ?? "Failed to generate purchaseInvoice sequence"
      );
    }

    const interaction = await client
      .from("supplierInteraction")
      .insert({ companyId: targetCompanyId, supplierId: supplier.data.id })
      .select("id")
      .single();
    if (interaction.error) throw new Error(interaction.error.message);

    const now = new Date().toISOString();
    const purchaseInvoice = await client
      .from("purchaseInvoice")
      .insert({
        invoiceId: seq.data,
        supplierId: supplier.data.id,
        invoiceSupplierId: supplier.data.id,
        supplierInteractionId: interaction.data.id,
        currencyCode,
        exchangeRate: 1,
        exchangeRateUpdatedAt: now,
        status: "Draft",
        dateIssued: now.split("T")[0],
        locationId: targetLocationId,
        companyId: targetCompanyId,
        createdBy: userId,
        updatedBy: userId
      })
      .select("id")
      .single();
    if (purchaseInvoice.error) throw new Error(purchaseInvoice.error.message);

    const purchaseInvoiceId = purchaseInvoice.data.id;

    const delivery = await client.from("purchaseInvoiceDelivery").insert({
      id: purchaseInvoiceId,
      locationId: targetLocationId,
      companyId: targetCompanyId
    });
    if (delivery.error) throw new Error(delivery.error.message);

    let sortOrder = 1;
    for (const line of invoiceLines) {
      const isComment = line.invoiceLineType === "Comment";
      const isItem =
        !!line.itemId &&
        (MIRRORABLE_ITEM_TYPES as readonly string[]).includes(
          line.invoiceLineType
        );
      if (!isComment && !isItem) continue; // skip Fixed Asset

      const insertLine = await client.from("purchaseInvoiceLine").insert({
        invoiceId: purchaseInvoiceId,
        invoiceLineType:
          line.invoiceLineType as Database["public"]["Enums"]["payableLineType"],
        itemId: isItem ? mapById.get(line.itemId as string) : null,
        description: line.description ?? null,
        quantity: line.quantity ?? 0,
        purchaseUnitOfMeasureCode: line.unitOfMeasureCode ?? null,
        inventoryUnitOfMeasureCode: line.unitOfMeasureCode ?? null,
        conversionFactor: 1,
        supplierUnitPrice: line.unitPrice ?? 0,
        unitPrice: line.unitPrice ?? 0,
        exchangeRate: 1,
        locationId: isItem ? targetLocationId : null,
        sortOrder: sortOrder++,
        companyId: targetCompanyId,
        createdBy: userId,
        updatedBy: userId
      });
      if (insertLine.error) throw new Error(insertLine.error.message);
    }

    const linked = await upsertLink(client, base, {
      status: "Mirrored",
      targetDocumentId: purchaseInvoiceId,
      lastSyncedAt: now
    });
    if (linked.error) throw new Error(linked.error.message);

    await notifyAccountingOwners(
      client,
      targetCompanyId,
      purchaseInvoiceId,
      NotificationEvent.PurchaseInvoiceAssignment
    );

    return { mirrored: purchaseInvoiceId };
  } catch (err) {
    await upsertLink(client, base, {
      status: "Exception",
      failureReason: (err as Error).message
    }).catch(() => {
      // Best-effort — swallow secondary failures recording the Exception.
    });
    return { error: (err as Error).message };
  }
}

// ============================================================
// Inngest functions
// ============================================================

export const intercompanyMirrorPoFunction = inngest.createFunction(
  { id: "intercompany-mirror-po", retries: 2 },
  { event: "carbon/intercompany-mirror-po" },
  async ({ event, step }) => {
    const payload = MirrorPoPayloadSchema.parse(event.data);
    return await step.run("mirror-purchase-order", () =>
      mirrorPurchaseOrder(payload)
    );
  }
);

export const intercompanyMirrorInvoiceFunction = inngest.createFunction(
  { id: "intercompany-mirror-invoice", retries: 2 },
  { event: "carbon/intercompany-mirror-invoice" },
  async ({ event, step }) => {
    const payload = MirrorInvoicePayloadSchema.parse(event.data);
    return await step.run("mirror-sales-invoice", () =>
      mirrorSalesInvoice(payload)
    );
  }
);
