import { sql, Transaction } from "kysely";
import type { KyselyDatabase as DB } from "../lib/postgres/index.ts";
import { getNextSequence } from "./get-next-sequence.ts";

/**
 * Stamps the per-unit warranty registrations that a posting creates.
 *
 * Called from INSIDE the posting transaction: a posted shipment or invoice
 * whose registrations failed to write would be a silent gap in the install
 * base, so a failure here rolls the posting back rather than being logged.
 *
 * Which posting stamps a row is decided by the item's term:
 *   startBasis 'Ship Date'    -> post-shipment
 *   startBasis 'Invoice Date' -> post-sales-invoice
 *
 * Each row records the line that stamped it — `shipmentLineId` or
 * `salesInvoiceLineId` — which is both the void key and the idempotency key
 * (partial unique indexes back it, so a void/re-post cycle cannot duplicate).
 */

export type StampSource = {
  /** The line that stamps the row; exactly one of these is the source key. */
  shipmentLineId?: string;
  salesInvoiceLineId?: string;
  itemId: string;
  quantity: number;
  /** Serial/batch entities shipped on this line, if any. */
  trackedEntityIds: string[];
};

export async function stampWarrantyRegistrations(
  trx: Transaction<DB>,
  {
    companyId,
    userId,
    customerId,
    today,
    basis,
    sources,
  }: {
    companyId: string;
    userId: string;
    customerId: string;
    today: string;
    basis: "Ship Date" | "Invoice Date";
    sources: StampSource[];
  }
): Promise<number> {
  if (sources.length === 0) return 0;

  const itemIds = [...new Set(sources.map((s) => s.itemId))];

  // One read for every item's terms — never per line.
  const items = await trx
    .selectFrom("item")
    .select(["id", "warrantyTermId", "supplierWarrantyTermId"])
    .where("id", "in", itemIds)
    .where("companyId", "=", companyId)
    .execute();

  const termIds = [
    ...new Set(
      items
        .flatMap((i) => [i.warrantyTermId, i.supplierWarrantyTermId])
        .filter(Boolean) as string[]
    ),
  ];
  if (termIds.length === 0) return 0;

  const terms = await trx
    .selectFrom("warrantyTerm")
    .selectAll()
    .where("id", "in", termIds)
    .where("companyId", "=", companyId)
    .execute();

  const termById = new Map(terms.map((t) => [t.id, t]));
  const itemById = new Map(items.map((i) => [i.id, i]));

  // Month arithmetic in SQL: Postgres clamps day-of-month the way a warranty
  // should (31 Jan + 1 month = 28 Feb), and no JS Date is involved.
  const addMonths = async (months: number | null): Promise<string | null> => {
    if (months === null || months === undefined) return null;
    const row = await sql<{ d: string }>`
      select to_char((${today}::date + (${months} || ' months')::interval)::date, 'YYYY-MM-DD') as d
    `.execute(trx);
    return row.rows[0]?.d ?? null;
  };

  // Supplier warranty is advisory provenance: resolve it only from a DIRECT
  // purchase-receipt ancestor of the entity. Anything ambiguous stays NULL
  // rather than guessing at a date somebody might rely on.
  const supplierByEntity = new Map<
    string,
    { supplierId: string; receiptDate: string }
  >();
  const allEntityIds = sources.flatMap((s) => s.trackedEntityIds);
  if (allEntityIds.length > 0) {
    const entities = await trx
      .selectFrom("trackedEntity")
      .select(["id", "attributes", "createdAt"])
      .where("id", "in", allEntityIds)
      .where("companyId", "=", companyId)
      .execute();

    for (const entity of entities) {
      const attributes = (entity.attributes ?? {}) as Record<string, unknown>;
      const supplierId = attributes["Supplier"];
      const receiptId = attributes["Receipt"];
      if (typeof supplierId !== "string" || typeof receiptId !== "string") {
        continue;
      }
      const receipt = await trx
        .selectFrom("receipt")
        .select(["postingDate"])
        .where("id", "=", receiptId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (receipt?.postingDate) {
        supplierByEntity.set(entity.id, {
          supplierId,
          receiptDate: receipt.postingDate,
        });
      }
    }
  }

  type RegistrationInsert = {
    warrantyRegistrationId: string;
    itemId: string;
    customerId: string;
    trackedEntityId: string | null;
    shipmentLineId: string | null;
    salesInvoiceLineId: string | null;
    quantity: number;
    warrantyTermId: string;
    startDate: string;
    coversParts: boolean;
    partsExpirationDate: string | null;
    coversLabor: boolean;
    laborExpirationDate: string | null;
    supplierId: string | null;
    supplierWarrantyExpirationDate: string | null;
    companyId: string;
    createdBy: string;
  };

  const inserts: RegistrationInsert[] = [];

  for (const source of sources) {
    const item = itemById.get(source.itemId);
    const term = item?.warrantyTermId
      ? termById.get(item.warrantyTermId)
      : undefined;
    // Only this posting's basis stamps here; the other basis belongs to the
    // sibling posting function.
    if (!term || term.startBasis !== basis) continue;

    const partsExpirationDate = await addMonths(
      term.coversParts ? term.partsDurationMonths : null
    );
    const laborExpirationDate = await addMonths(
      term.coversLabor ? term.laborDurationMonths : null
    );

    const supplierTerm = item?.supplierWarrantyTermId
      ? termById.get(item.supplierWarrantyTermId)
      : undefined;

    const buildRow = async (
      trackedEntityId: string | null,
      quantity: number
    ): Promise<RegistrationInsert> => {
      let supplierId: string | null = null;
      let supplierWarrantyExpirationDate: string | null = null;

      const provenance = trackedEntityId
        ? supplierByEntity.get(trackedEntityId)
        : undefined;
      if (provenance && supplierTerm) {
        supplierId = provenance.supplierId;
        // The supplier's clock starts when WE received the unit.
        const months =
          supplierTerm.partsDurationMonths ?? supplierTerm.laborDurationMonths;
        if (months !== null && months !== undefined) {
          const row = await sql<{ d: string }>`
            select to_char((${provenance.receiptDate}::date + (${months} || ' months')::interval)::date, 'YYYY-MM-DD') as d
          `.execute(trx);
          supplierWarrantyExpirationDate = row.rows[0]?.d ?? null;
        }
      }

      const readableId = await getNextSequence(
        trx,
        "warrantyRegistration",
        companyId
      );

      return {
        warrantyRegistrationId: readableId,
        itemId: source.itemId,
        customerId,
        trackedEntityId,
        shipmentLineId: source.shipmentLineId ?? null,
        salesInvoiceLineId: source.salesInvoiceLineId ?? null,
        quantity,
        warrantyTermId: term.id,
        startDate: today,
        coversParts: term.coversParts,
        partsExpirationDate,
        coversLabor: term.coversLabor,
        laborExpirationDate,
        supplierId,
        supplierWarrantyExpirationDate,
        companyId,
        createdBy: userId,
      };
    };

    if (source.trackedEntityIds.length > 0) {
      // One registration per unit — the tracked entity IS the install-base row.
      for (const entityId of source.trackedEntityIds) {
        inserts.push(await buildRow(entityId, 1));
      }
    } else if (source.salesInvoiceLineId && !source.shipmentLineId) {
      // Invoice-stamped and unresolvable to a shipment line: fine for an
      // untracked item (quantity row), but a TRACKED item would have to be
      // registered with a null identity, which tracked coverage could never
      // find again. Skip it and let a manual registration fix it.
      const trackingType = await trx
        .selectFrom("item")
        .select(["itemTrackingType"])
        .where("id", "=", source.itemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (
        trackingType?.itemTrackingType === "Serial" ||
        trackingType?.itemTrackingType === "Batch"
      ) {
        continue;
      }
      inserts.push(await buildRow(null, source.quantity));
    } else {
      inserts.push(await buildRow(null, source.quantity));
    }
  }

  if (inserts.length === 0) return 0;

  // The partial unique indexes make a re-post idempotent rather than duplicated.
  await trx
    .insertInto("warrantyRegistration")
    .values(inserts)
    .onConflict((oc) => oc.doNothing())
    .execute();

  return inserts.length;
}

/**
 * Removes the registrations a voided document stamped, matched on that
 * document's own key. Manual and repair-issued rows (both keys NULL) survive:
 * they are not owned by any posting.
 */
export async function removeWarrantyRegistrations(
  trx: Transaction<DB>,
  {
    companyId,
    shipmentLineIds,
    salesInvoiceLineIds,
  }: {
    companyId: string;
    shipmentLineIds?: string[];
    salesInvoiceLineIds?: string[];
  }
): Promise<void> {
  if (shipmentLineIds && shipmentLineIds.length > 0) {
    await trx
      .deleteFrom("warrantyRegistration")
      .where("companyId", "=", companyId)
      .where("shipmentLineId", "in", shipmentLineIds)
      .where("salesInvoiceLineId", "is", null)
      .execute();
  }
  if (salesInvoiceLineIds && salesInvoiceLineIds.length > 0) {
    await trx
      .deleteFrom("warrantyRegistration")
      .where("companyId", "=", companyId)
      .where("salesInvoiceLineId", "in", salesInvoiceLineIds)
      .execute();
  }
}
