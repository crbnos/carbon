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
  /**
   * What the shipper chose on this line, if anything. Beats every rule — the
   * whole point is that warranty is not welded to the part.
   */
  warrantyTermId?: string | null;
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
    .select(["id", "warrantyTermId", "supplierWarrantyTermId", "itemTrackingType"])
    .where("id", "in", itemIds)
    .where("companyId", "=", companyId)
    .execute();

  const trackingTypeByItem = new Map(
    items.map((item) => [item.id, item.itemTrackingType])
  );
  const itemById = new Map(items.map((item) => [item.id, item]));

  // Customer rules: a row per (customer, item) and optionally one catch-all
  // row for the customer. Read once, not per line.
  const customerRules = await trx
    .selectFrom("customerWarrantyTerm")
    .select(["itemId", "warrantyTermId"])
    .where("customerId", "=", customerId)
    .where("companyId", "=", companyId)
    .execute();

  const customerItemTerm = new Map<string, string>();
  let customerAllItemsTerm: string | null = null;
  for (const rule of customerRules) {
    if (rule.itemId) customerItemTerm.set(rule.itemId, rule.warrantyTermId);
    else customerAllItemsTerm = rule.warrantyTermId;
  }

  /**
   * Most specific wins. The item's own term is only the fallback, so the same
   * part can carry different cover for different customers.
   */
  const resolveTermId = (source: StampSource): string | null =>
    source.warrantyTermId ??
    customerItemTerm.get(source.itemId) ??
    customerAllItemsTerm ??
    itemById.get(source.itemId)?.warrantyTermId ??
    null;

  const termIds = [
    ...new Set(
      [
        ...sources.map(resolveTermId),
        ...items.map((i) => i.supplierWarrantyTermId),
      ].filter(Boolean) as string[]
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

  // Month arithmetic in SQL: Postgres clamps day-of-month the way a warranty
  // should (31 Jan + 1 month = 28 Feb), and no JS Date is involved.
  // Postgres clamps day-of-month the way a warranty should (31 Jan + 1 month =
  // 28 Feb), so the arithmetic stays in SQL — but it is resolved ONCE per
  // (base date, duration) pair rather than once per registration row.
  const dateCache = new Map<string, string | null>();
  const addMonthsFrom = async (
    base: string,
    months: number | null
  ): Promise<string | null> => {
    if (months === null || months === undefined) return null;
    const key = `${base}::${months}`;
    const cached = dateCache.get(key);
    if (cached !== undefined) return cached;
    const row = await sql<{ d: string }>`
      select to_char((${base}::date + (${months} || ' months')::interval)::date, 'YYYY-MM-DD') as d
    `.execute(trx);
    const value = row.rows[0]?.d ?? null;
    dateCache.set(key, value);
    return value;
  };
  const addMonths = (months: number | null) => addMonthsFrom(today, months);

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

    // Collect the receipt ids first and read them in ONE query — a shipment of
    // a few hundred serials would otherwise issue a few hundred round trips
    // inside the posting transaction.
    const receiptIdByEntity = new Map<string, string>();
    const supplierIdByEntity = new Map<string, string>();
    for (const entity of entities) {
      const attributes = (entity.attributes ?? {}) as Record<string, unknown>;
      const supplierId = attributes["Supplier"];
      const receiptId = attributes["Receipt"];
      if (typeof supplierId !== "string" || typeof receiptId !== "string") {
        continue;
      }
      receiptIdByEntity.set(entity.id, receiptId);
      supplierIdByEntity.set(entity.id, supplierId);
    }

    const receiptIds = [...new Set(receiptIdByEntity.values())];
    if (receiptIds.length > 0) {
      const receipts = await trx
        .selectFrom("receipt")
        .select(["id", "postingDate"])
        .where("id", "in", receiptIds)
        .where("companyId", "=", companyId)
        .execute();
      const postingDateByReceipt = new Map(
        receipts
          .filter((receipt) => receipt.postingDate)
          .map((receipt) => [receipt.id, receipt.postingDate as string])
      );

      for (const [entityId, receiptId] of receiptIdByEntity) {
        const receiptDate = postingDateByReceipt.get(receiptId);
        const supplierId = supplierIdByEntity.get(entityId);
        if (receiptDate && supplierId) {
          supplierByEntity.set(entityId, { supplierId, receiptDate });
        }
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
    const resolvedTermId = resolveTermId(source);
    const term = resolvedTermId ? termById.get(resolvedTermId) : undefined;
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
        supplierWarrantyExpirationDate = await addMonthsFrom(
          provenance.receiptDate,
          months ?? null
        );
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
      const trackingType = trackingTypeByItem.get(source.itemId);
      if (trackingType === "Serial" || trackingType === "Batch") {
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
