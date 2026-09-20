import type { Database } from "@carbon/database";
import {
  patchRampCursor,
  prepareRampPurchaseOrderBatch,
  pushInvoiceDraftBill,
  pushPurchaseOrder,
  type RampClient,
  type RampIntegrationMetadata,
  type RampVendorSupplier
} from "@carbon/ee/ramp.server";
import {
  decodeRampKeysetCursor,
  encodeRampKeysetCursor,
  nextRampKeysetCursor,
  rampKeysetFilter
} from "./ramp-sync-cursor";
import {
  type RampFailureResult,
  recordRampFamilyError
} from "./ramp-sync-observability";
import { loadRampPurchaseOrderLines } from "./ramp-sync-outbound-lines";
import type { RampSyncContext } from "./ramp-sync-shared";

const OUTBOUND_PAGE_SIZE = 100;
const PO_PUSH_STATUSES: Database["public"]["Enums"]["purchaseOrderStatus"][] = [
  "To Review",
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed",
  "Closed"
];
// Posted-and-unpaid view statuses. "Overdue" is just Open past its due date, so
// it must push too — otherwise a bill silently stops being eligible the day it
// goes overdue.
const INVOICE_PUSH_STATUSES = ["Open", "Partially Paid", "Overdue"];

/** A supplier row with its purchasing contact + a location's address embedded. */
type SupplierVendorRow = {
  id: string;
  name: string | null;
  supplierTypeId: string | null;
  supplierContact: {
    contact: {
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      mobilePhone: string | null;
      homePhone: string | null;
      workPhone: string | null;
    } | null;
  } | null;
  supplierLocation: Array<{
    address: {
      countryCode: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      stateProvince: string | null;
      postalCode: string | null;
    } | null;
  }> | null;
};

/**
 * Batch-resolve suppliers with the contact + country a Ramp SPEND vendor needs
 * (option B: match-then-create). One query, never per-supplier: the purchasing
 * contact (`supplier.purchasingContactId`) supplies the required email; the first
 * location with a country supplies the required `country` (+ address). Returns a
 * map keyed by supplier id; `supplierTypeId` rides along for the invoice family's
 * employee-supplier check so it needs no second query.
 */
async function loadRampVendorSuppliers(
  ctx: RampSyncContext,
  supplierIds: string[]
): Promise<
  Map<string, RampVendorSupplier & { supplierTypeId: string | null }>
> {
  const map = new Map<
    string,
    RampVendorSupplier & { supplierTypeId: string | null }
  >();
  const ids = [...new Set(supplierIds.filter(Boolean))];
  if (ids.length === 0) return map;

  const { data, error } = await ctx.client
    .from("supplier")
    .select(
      "id, name, supplierTypeId, supplierContact!supplier_purchasingContactId_fkey(contact(email, firstName, lastName, mobilePhone, homePhone, workPhone)), supplierLocation!supplierLocation_supplierId_fkey(address(countryCode, addressLine1, addressLine2, city, stateProvince, postalCode))"
    )
    .eq("companyId", ctx.companyId)
    .in("id", ids);
  if (error) {
    throw new Error(`Failed to load Ramp vendor suppliers: ${error.message}`);
  }

  for (const row of (data ?? []) as unknown as SupplierVendorRow[]) {
    const contact = row.supplierContact?.contact ?? null;
    const addresses = (row.supplierLocation ?? [])
      .map((location) => location.address)
      .filter((address): address is NonNullable<typeof address> =>
        Boolean(address)
      );
    const address =
      addresses.find((candidate) => candidate.countryCode) ??
      addresses[0] ??
      null;

    map.set(row.id, {
      id: row.id,
      name: row.name,
      supplierTypeId: row.supplierTypeId ?? null,
      country: address?.countryCode ?? null,
      contact: contact
        ? {
            email: contact.email ?? null,
            firstName: contact.firstName ?? null,
            lastName: contact.lastName ?? null,
            phone:
              contact.mobilePhone ??
              contact.workPhone ??
              contact.homePhone ??
              null
          }
        : null,
      address: address
        ? {
            line1: address.addressLine1 ?? null,
            line2: address.addressLine2 ?? null,
            city: address.city ?? null,
            stateProvince: address.stateProvince ?? null,
            postalCode: address.postalCode ?? null
          }
        : null
    });
  }
  return map;
}

/** A bare supplier fallback when its details row is missing. */
function emptyRampVendorSupplier(
  id: string,
  name: string | null
): RampVendorSupplier {
  return { id, name, country: null, contact: null, address: null };
}

/**
 * Ramp requires an `entity_id` on a PO create. Prefer the configured
 * `metadata.entityId`; otherwise resolve the business's first entity (the common
 * single-entity case). Returns undefined only when neither is available.
 */
async function resolveRampEntityId(
  metadata: RampIntegrationMetadata,
  ramp: RampClient
): Promise<string | undefined> {
  if (metadata.entityId) return metadata.entityId;
  try {
    const res = await ramp.getEntities<{
      data?: Array<{ id?: string }>;
    }>();
    return res.data?.[0]?.id;
  } catch {
    return undefined;
  }
}

export async function syncRampOutbound(
  ctx: RampSyncContext,
  ramp: RampClient,
  integrationUpdatedAt: string | null | undefined
) {
  const { client, companyId, metadata } = ctx;
  const integrationRow = { data: { updatedAt: integrationUpdatedAt } };
  const result: {
    purchaseOrders: RampFailureResult & { pushed: number; archived: number };
    invoices: RampFailureResult & { pushed: number; archived: number };
  } = {
    purchaseOrders: { pushed: 0, archived: 0, failed: 0 },
    invoices: { pushed: 0, failed: 0, archived: 0 }
  };

  // -- 1. Purchase-order push --------------------------------------------
  if (metadata.sync.pushPurchaseOrders) {
    try {
      const storedCursor =
        metadata.cursors?.purchaseOrderPushUpdatedAt ??
        integrationRow.data?.updatedAt ??
        undefined;
      const cursor = decodeRampKeysetCursor(storedCursor);

      let poQuery = client
        .from("purchaseOrder")
        .select(
          "id, purchaseOrderId, status, supplierId, currencyCode, updatedAt"
        )
        .eq("companyId", companyId)
        .in("status", PO_PUSH_STATUSES)
        .order("updatedAt", { ascending: true })
        .order("id", { ascending: true })
        .limit(OUTBOUND_PAGE_SIZE);
      if (cursor?.id) {
        poQuery = poQuery.or(rampKeysetFilter(cursor).value);
      } else if (cursor) {
        poQuery = poQuery.gte("updatedAt", rampKeysetFilter(cursor).value);
      }
      const pos = await poQuery;
      if (pos.error) throw pos.error;
      const poRows = pos.data ?? [];

      if (poRows.length > 0) {
        // Batch the supplier vendor details + lines (never a query per PO).
        const supplierIds = [...new Set(poRows.map((row) => row.supplierId))];
        const supplierById = await loadRampVendorSuppliers(ctx, supplierIds);
        // Ramp requires an entity_id on a PO create — resolve it once.
        const rampEntityId = await resolveRampEntityId(metadata, ramp);

        const poIds = poRows.map((row) => row.id);
        // Push the DOCUMENT-currency price (`supplierUnitPrice`), not the
        // generated `unitPrice` — the latter is company-base
        // (supplierUnitPrice ÷ exchangeRate), but the Ramp PO is labelled
        // `currency: po.currencyCode` (the PO's transaction currency), which
        // is the currency `supplierUnitPrice` is denominated in. Sending base
        // amounts under a foreign-currency label mis-states every non-base PO.
        const lines = await loadRampPurchaseOrderLines(
          client,
          companyId,
          poIds
        );
        const linesByPo = new Map<
          string,
          Array<{
            id: string;
            description: string | null;
            quantity: number | null;
            unitPrice: number | null;
          }>
        >();
        for (const line of lines) {
          const list = linesByPo.get(line.purchaseOrderId) ?? [];
          list.push({
            id: line.id,
            description: line.description,
            quantity: line.purchaseQuantity,
            unitPrice: line.supplierUnitPrice
          });
          linesByPo.set(line.purchaseOrderId, list);
        }

        const prerequisites = await prepareRampPurchaseOrderBatch(
          ctx.mapping,
          ramp,
          poIds,
          poRows
            .filter(
              (row) => row.status !== "Completed" && row.status !== "Closed"
            )
            .map(
              (row) =>
                supplierById.get(row.supplierId) ??
                emptyRampVendorSupplier(row.supplierId, null)
            )
        );
        const failedIds = new Set<string>();
        for (const row of poRows) {
          try {
            const action = await pushPurchaseOrder(
              ctx.mapping,
              ramp,
              {
                id: row.id,
                readableId: row.purchaseOrderId,
                status: row.status,
                supplier:
                  supplierById.get(row.supplierId) ??
                  emptyRampVendorSupplier(row.supplierId, null),
                currencyCode: row.currencyCode ?? ctx.baseCurrency,
                entityId: rampEntityId,
                lines: linesByPo.get(row.id) ?? []
              },
              companyId,
              prerequisites
            );
            if (action === "archived") result.purchaseOrders.archived += 1;
            else if (action === "created" || action === "patched")
              result.purchaseOrders.pushed += 1;
          } catch (poError) {
            result.purchaseOrders.failed += 1;
            failedIds.add(row.id);
            console.error(
              `[RAMP SYNC] ${companyId}: purchase order ${row.purchaseOrderId} push failed`,
              poError
            );
          }
        }

        const cursorRows = poRows.filter(
          (row): row is typeof row & { updatedAt: string } =>
            Boolean(row.updatedAt)
        );
        const next =
          cursorRows.length === poRows.length
            ? nextRampKeysetCursor(cursorRows, failedIds)
            : null;
        if (next) {
          await patchRampCursor(
            client,
            companyId,
            "purchaseOrderPushUpdatedAt",
            encodeRampKeysetCursor(next)
          );
        }
      }
    } catch (familyError) {
      console.error(
        `[RAMP SYNC] ${companyId}: purchase-order push failed`,
        familyError
      );
      recordRampFamilyError(result.purchaseOrders, familyError);
    }
  }

  // -- 2. Invoice draft-bill push -----------------------------------------
  // Carbon pushes a coded DRAFT ("provisional bill") and hands off; the
  // customer completes payment + approves it in Ramp. There is no
  // archive-on-settlement: a Ramp draft has no delete endpoint (verified
  // 405/404), and once handed off Ramp owns the bill's lifecycle.
  if (metadata.sync.pushInvoices) {
    try {
      // Skip an invoice already mapped in either direction (Task 8).
      const billMappings = await ctx.mapping.getAllByIntegration(
        "ramp",
        "bill"
      );
      const mappedInvoiceIds = new Set(billMappings.map((m) => m.entityId));

      // 2. Push posted, still-unpaid invoices. Page on `createdAt`, NOT
      // `updatedAt`: a purchase invoice's `updatedAt` is null until an
      // app-level edit (posting never sets it), so an updatedAt keyset makes
      // every posted invoice invisible. The mapping guard (mappedInvoiceIds) is
      // the real idempotency — the push is create-once, so createdAt is a
      // sufficient, always-set page key. On first run (no stored cursor) start
      // from the beginning so pre-existing open payables are pushed; do NOT
      // floor at the integration's own updatedAt (that excluded everything).
      const storedCursor = metadata.cursors?.invoicePushUpdatedAt ?? undefined;
      const cursor = decodeRampKeysetCursor(storedCursor);

      let invQuery = client
        .from("purchaseInvoices")
        .select(
          "id, invoiceId, supplierId, supplierReference, dateIssued, dateDue, createdAt"
        )
        .eq("companyId", companyId)
        .in("status", INVOICE_PUSH_STATUSES)
        .order("createdAt", { ascending: true })
        .order("id", { ascending: true })
        .limit(OUTBOUND_PAGE_SIZE);
      if (cursor?.id) {
        invQuery = invQuery.or(rampKeysetFilter(cursor, "createdAt").value);
      } else if (cursor) {
        invQuery = invQuery.gte(
          "createdAt",
          rampKeysetFilter(cursor, "createdAt").value
        );
      }
      const invoices = await invQuery;
      if (invoices.error) throw invoices.error;
      const invRows = invoices.data ?? [];
      // Advance past EVERY fetched row (mapped / employee / pushed alike);
      // only a throw holds the cursor back.
      const failedIds = new Set<string>();

      const candidates = invRows.filter(
        (row) => row.id && !mappedInvoiceIds.has(row.id)
      );

      if (candidates.length > 0) {
        const supplierIds = [
          ...new Set(
            candidates
              .map((row) => row.supplierId)
              .filter((id): id is string => Boolean(id))
          )
        ];
        const supplierById = await loadRampVendorSuppliers(ctx, supplierIds);

        // Resolve which supplier types are "Employee" (reimbursement
        // suppliers — their invoices never push).
        const typeIds = [
          ...new Set(
            [...supplierById.values()]
              .map((s) => s.supplierTypeId)
              .filter((id): id is string => Boolean(id))
          )
        ];
        const employeeTypeIds = new Set<string>();
        if (typeIds.length > 0) {
          const types = await client
            .from("supplierType")
            .select("id, name")
            .eq("companyId", companyId)
            .in("id", typeIds);
          if (types.error) {
            throw new Error(
              `Failed to classify Ramp invoice supplier types: ${types.error.message}`
            );
          }
          for (const type of types.data ?? []) {
            if (type.name === "Employee") employeeTypeIds.add(type.id);
          }
        }

        // Only accounts / cost centers Carbon has pushed to Ramp are valid
        // coding options; coding a line to an unpushed option would 422 the
        // whole bill, so a line coded to one degrades to uncoded instead.
        const [accountMappings, costCenterMappings, projectMappings] =
          await Promise.all([
            ctx.mapping.getAllByIntegration("ramp", "account"),
            ctx.mapping.getAllByIntegration("ramp", "costCenter"),
            ctx.mapping.getAllByIntegration("ramp", "project")
          ]);
        const pushed = {
          pushedAccountIds: new Set(accountMappings.map((m) => m.entityId)),
          pushedCostCenterIds: new Set(
            costCenterMappings.map((m) => m.entityId)
          ),
          pushedProjectIds: new Set(projectMappings.map((m) => m.entityId))
        };

        for (const row of candidates) {
          const invoiceRowId = row.id;
          if (!invoiceRowId) continue;
          const supplier = supplierById.get(row.supplierId ?? "");
          // Employee-supplier reimbursements never push.
          if (
            supplier?.supplierTypeId &&
            employeeTypeIds.has(supplier.supplierTypeId)
          ) {
            continue;
          }
          try {
            // Line amounts + GL/cost-center coding are read from the invoice's
            // POSTED journal inside pushInvoiceDraftBill (loadBillCostingLines),
            // not from the invoice line — an item line has no account of its own.
            const outcome = await pushInvoiceDraftBill(
              ctx.db,
              companyId,
              ctx.mapping,
              ramp,
              {
                id: invoiceRowId,
                readableId: row.invoiceId ?? invoiceRowId,
                supplierReference: row.supplierReference,
                dateIssued: row.dateIssued,
                dateDue: row.dateDue,
                supplier:
                  supplier ??
                  emptyRampVendorSupplier(row.supplierId ?? "", null)
              },
              pushed
            );
            if (outcome === "pushed") result.invoices.pushed += 1;
          } catch (invoiceError) {
            result.invoices.failed += 1;
            failedIds.add(invoiceRowId);
            console.error(
              `[RAMP SYNC] ${companyId}: invoice ${
                row.invoiceId ?? invoiceRowId
              } push failed`,
              invoiceError
            );
          }
        }
      }

      // The keyset advances on `createdAt` (mapped into the cursor's timestamp
      // slot), since that is the column the invoice page is ordered by.
      const cursorRows = invRows
        .filter((row): row is typeof row & { id: string; createdAt: string } =>
          Boolean(row.id && row.createdAt)
        )
        .map((row) => ({ id: row.id, updatedAt: row.createdAt }));
      const next =
        cursorRows.length === invRows.length
          ? nextRampKeysetCursor(cursorRows, failedIds)
          : null;
      if (next) {
        await patchRampCursor(
          client,
          companyId,
          "invoicePushUpdatedAt",
          encodeRampKeysetCursor(next)
        );
      }
    } catch (familyError) {
      console.error(
        `[RAMP SYNC] ${companyId}: invoice push failed`,
        familyError
      );
      recordRampFamilyError(result.invoices, familyError);
    }
  }

  return result;
}
