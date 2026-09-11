import type { Database } from "@carbon/database";
import {
  archiveRampBillForInvoice,
  patchRampCursor,
  prepareRampPurchaseOrderBatch,
  pushInvoiceDraftBill,
  pushPurchaseOrder,
  type RampClient,
  type RampIntegrationMetadata,
  type RampVendorSupplier
} from "@carbon/ee/ramp.server";
import { toDocumentAmount } from "@carbon/utils";
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
import {
  loadRampPurchaseInvoiceLines,
  loadRampPurchaseOrderLines
} from "./ramp-sync-outbound-lines";
import {
  getRampCurrencyDecimals,
  type RampSyncContext
} from "./ramp-sync-shared";

const OUTBOUND_PAGE_SIZE = 100;
const PO_PUSH_STATUSES: Database["public"]["Enums"]["purchaseOrderStatus"][] = [
  "To Review",
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed",
  "Closed"
];
const INVOICE_PUSH_STATUSES = ["Open", "Partially Paid"];
const INVOICE_SETTLED_STATUSES = new Set(["Paid", "Voided"]);

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

  // -- 2 + 3. Invoice draft-bill push & archive-on-settlement -------------
  if (metadata.sync.pushInvoices) {
    try {
      // One scan of the `bill` mappings drives BOTH the push dedupe (skip an
      // invoice already mapped in either direction — Task 8) and the archive.
      const billMappings = await ctx.mapping.getAllByIntegration(
        "ramp",
        "bill"
      );
      const mappedInvoiceIds = new Set(billMappings.map((m) => m.entityId));

      // 2. Push posted invoices that are still Open / Partially Paid.
      const storedCursor =
        metadata.cursors?.invoicePushUpdatedAt ??
        integrationRow.data?.updatedAt ??
        undefined;
      const cursor = decodeRampKeysetCursor(storedCursor);

      let invQuery = client
        .from("purchaseInvoices")
        .select(
          "id, invoiceId, supplierId, supplierReference, currencyCode, exchangeRate, dateIssued, dateDue, updatedAt"
        )
        .eq("companyId", companyId)
        .in("status", INVOICE_PUSH_STATUSES)
        .order("updatedAt", { ascending: true })
        .order("id", { ascending: true })
        .limit(OUTBOUND_PAGE_SIZE);
      if (cursor?.id) {
        invQuery = invQuery.or(rampKeysetFilter(cursor).value);
      } else if (cursor) {
        invQuery = invQuery.gte("updatedAt", rampKeysetFilter(cursor).value);
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

        const invoiceIds = candidates
          .map((row) => row.id)
          .filter((id): id is string => Boolean(id));
        // `totalAmount` is the generated COMPANY-BASE line total
        // (supplierUnitPrice·qty ÷ rate + shipping ÷ rate + tax ÷ rate). It
        // is converted back to the invoice's document currency per candidate
        // below, since Ramp is told `invoice_currency: invoice.currencyCode`.
        const invLines = await loadRampPurchaseInvoiceLines(
          client,
          companyId,
          invoiceIds
        );
        const linesByInvoice = new Map<
          string,
          Array<{ description: string | null; amount: number }>
        >();
        for (const line of invLines) {
          const list = linesByInvoice.get(line.invoiceId) ?? [];
          list.push({
            description: line.description,
            amount: line.totalAmount ?? 0
          });
          linesByInvoice.set(line.invoiceId, list);
        }

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
            // Convert each base line total to the invoice's document
            // currency (base × foreign-per-base rate, rounded at the
            // currency's decimals) so the pushed amounts match the
            // `invoice_currency` label. A base-currency invoice has rate 1,
            // so this only rounds to settlement precision.
            const invoiceCurrency = row.currencyCode ?? ctx.baseCurrency;
            const invoiceRate =
              invoiceCurrency === ctx.baseCurrency ? 1 : row.exchangeRate;
            if (
              typeof invoiceRate !== "number" ||
              !Number.isFinite(invoiceRate) ||
              invoiceRate <= 0
            ) {
              throw new Error(
                `Invoice in ${invoiceCurrency} requires a finite positive exchange rate`
              );
            }
            const invoiceDecimals = await getRampCurrencyDecimals(
              ctx,
              invoiceCurrency
            );
            const documentLines = (linesByInvoice.get(invoiceRowId) ?? []).map(
              (line) => ({
                description: line.description,
                amount: toDocumentAmount(
                  line.amount,
                  invoiceRate,
                  invoiceDecimals
                )
              })
            );
            const outcome = await pushInvoiceDraftBill(
              client,
              companyId,
              ctx.mapping,
              ramp,
              {
                id: invoiceRowId,
                readableId: row.invoiceId ?? invoiceRowId,
                supplierReference: row.supplierReference,
                currencyCode: invoiceCurrency,
                dateIssued: row.dateIssued,
                dateDue: row.dateDue,
                supplier:
                  supplier ??
                  emptyRampVendorSupplier(row.supplierId ?? "", null),
                lines: documentLines
              }
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

      const cursorRows = invRows.filter(
        (row): row is typeof row & { id: string; updatedAt: string } =>
          Boolean(row.id && row.updatedAt)
      );
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

      // 3. Archive-on-settlement: pushed bills whose invoice is now settled.
      const notArchived = billMappings.filter((m) => {
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        return meta.archived !== true && meta.rampPaid !== true;
      });
      if (notArchived.length > 0) {
        const settledIds = [...new Set(notArchived.map((m) => m.entityId))];
        const statuses = await client
          .from("purchaseInvoices")
          .select("id, status")
          .eq("companyId", companyId)
          .in("id", settledIds);
        const statusById = new Map(
          (statuses.data ?? []).map((row) => [row.id, row.status])
        );
        for (const m of notArchived) {
          const status = statusById.get(m.entityId);
          if (!status || !INVOICE_SETTLED_STATUSES.has(status)) continue;
          try {
            await archiveRampBillForInvoice(ctx.mapping, ramp, m);
            result.invoices.archived += 1;
          } catch (archiveError) {
            console.error(
              `[RAMP SYNC] ${companyId}: bill archive for invoice ${m.entityId} failed`,
              archiveError
            );
          }
        }
      }
    } catch (familyError) {
      console.error(
        `[RAMP SYNC] ${companyId}: invoice push / archive failed`,
        familyError
      );
      recordRampFamilyError(result.invoices, familyError);
    }
  }

  return result;
}
