// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The Carbon state a spend platform needs to hand off a payable.
 *
 * Provider-neutral, and three parts are easy to get wrong when writing a second
 * adapter:
 *
 * - **Status comes from the `purchaseInvoices` VIEW, never the table.** The view
 *   DERIVES status: a fully settled invoice reads "Paid" there while the table
 *   still stores "Open", and "Partially Paid"/"Overdue" exist only in the view.
 *   Reading the table hands the platform bills that are already paid.
 * - **Dates are normalized to `YYYY-MM-DD` strings.** Belt-and-braces now that
 *   the driver decodes DATE columns as strings (see
 *   `numeric-precision.md` → "Runtime type decoding"), but a platform that gets a
 *   full timestamp where it wants a date rejects the whole document.
 * - **Lines are the account-costed replay of the posted "Purchase Invoice"
 *   journal**, never `purchaseInvoiceLine.accountId` — an item line carries no
 *   account of its own (posting resolves the real inventory / GR-IR / variance /
 *   tax accounts), so reading the line leaves every item bill uncoded. Same
 *   `loadBillCostingLines` path the accounting providers use.
 */

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  loadBillCostingLines,
  toTransactionCurrencyLines
} from "../accounting/core/document-costing";
import { toPostingDateString } from "../accounting/core/posting";
import { EMPLOYEE_SUPPLIER_TYPE } from "./gates";
import {
  emptySpendVendorParty,
  loadSpendVendorParties,
  type SpendVendorParty
} from "./parties";

export type SpendBillSource = {
  id: string;
  readableId: string;
  /** The VIEW's derived status — see the header. */
  status: string;
  supplierReference: string | null;
  dateIssued: string | null;
  dateDue: string | null;
  updatedAt: string | null;
  /** Its invoices belong to the platform already; never push them back. */
  isEmployeeParty: boolean;
  /**
   * The purchase orders this invoice bills, by readable id, in order.
   *
   * An invoice's lines may each name a different order, so this is a list and
   * not a field — a consolidated invoice against three orders is ordinary. It
   * exists so a pushed bill can SAY which orders it settles: a spend platform
   * matches bill to order by its own rules, and when that match does not happen
   * the person looking at the bill has nothing to go on otherwise.
   */
  purchaseOrderReadableIds: string[];
  supplier: SpendVendorParty;
};

/** One costed line in DOCUMENT currency, ready for a platform's line shape. */
export type SpendBillLine = {
  memo: string | undefined;
  amount: number;
  accountId: string | null;
  costCenterId: string | null;
  projectId: string | null;
};

/**
 * The coding options the spend platform will accept, as
 * `Carbon id -> the id to send on the wire`.
 *
 * A MAP rather than a membership set because the wire id is not always Carbon's.
 * When Carbon holds the platform's accounting seat it published the options
 * itself, keyed by Carbon id, so the two coincide. When ANOTHER system holds the
 * seat (a push-only install) the options in the platform are that system's, and a
 * line coded with a Carbon id addresses nothing — the bill arrives uncoded and
 * someone has to code it by hand, which is exactly what pushing it was meant to
 * avoid.
 *
 * A line whose option is absent from the map degrades to uncoded rather than
 * failing the push.
 */
export type SpendPushedCoding = {
  pushedAccountIds: ReadonlyMap<string, string>;
  pushedCostCenterIds: ReadonlyMap<string, string>;
  pushedProjectIds: ReadonlyMap<string, string>;
};

export async function loadBillPushSource(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  ids: string[]
): Promise<Map<string, SpendBillSource>> {
  const result = new Map<string, SpendBillSource>();
  if (ids.length === 0) return result;

  const invoices = await db
    .selectFrom("purchaseInvoices")
    .select([
      "id",
      "invoiceId",
      "status",
      "supplierId",
      "supplierReference",
      "dateIssued",
      "dateDue",
      "updatedAt"
    ])
    .where("companyId", "=", companyId)
    .where("id", "in", ids)
    .execute();

  if (invoices.length === 0) return result;

  const partiesById = await loadSpendVendorParties(
    db,
    companyId,
    invoices
      .map((invoice) => invoice.supplierId)
      .filter((id): id is string => Boolean(id))
  );

  const purchaseOrdersByInvoice = await loadBilledPurchaseOrderIds(
    db,
    companyId,
    invoices
      .map((invoice) => invoice.id)
      .filter((id): id is string => Boolean(id))
  );

  const typeIds = [
    ...new Set(
      [...partiesById.values()]
        .map((party) => party.supplierTypeId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const employeeTypeIds = new Set<string>();
  if (typeIds.length > 0) {
    const types = await db
      .selectFrom("supplierType")
      .select(["id", "name"])
      .where("companyId", "=", companyId)
      .where("id", "in", typeIds)
      .execute();
    for (const type of types) {
      if (type.name === EMPLOYEE_SUPPLIER_TYPE) employeeTypeIds.add(type.id);
    }
  }

  for (const invoice of invoices) {
    // Every column on the view is typed nullable; `id` never is in practice.
    if (!invoice.id) continue;

    const party = invoice.supplierId
      ? partiesById.get(invoice.supplierId)
      : undefined;

    result.set(invoice.id, {
      id: invoice.id,
      readableId: invoice.invoiceId ?? invoice.id,
      status: invoice.status ?? "",
      supplierReference: invoice.supplierReference,
      dateIssued: invoice.dateIssued
        ? toPostingDateString(invoice.dateIssued)
        : null,
      dateDue: invoice.dateDue ? toPostingDateString(invoice.dateDue) : null,
      updatedAt: invoice.updatedAt,
      isEmployeeParty: Boolean(
        party?.supplierTypeId && employeeTypeIds.has(party.supplierTypeId)
      ),
      purchaseOrderReadableIds: purchaseOrdersByInvoice.get(invoice.id) ?? [],
      supplier:
        party ?? emptySpendVendorParty(invoice.supplierId ?? invoice.id, null)
    });
  }

  return result;
}

/**
 * The purchase orders each invoice bills, by readable id.
 *
 * The link lives on the LINE (`purchaseInvoiceLine.purchaseOrderId`), not the
 * header, so one invoice can settle several orders and several lines can name
 * the same one. One query for every invoice in the batch, de-duplicated per
 * invoice, ordered so the value is stable between syncs.
 */
async function loadBilledPurchaseOrderIds(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  invoiceIds: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (invoiceIds.length === 0) return result;

  const rows = await db
    .selectFrom("purchaseInvoiceLine")
    .innerJoin("purchaseOrder", (join) =>
      join
        .onRef("purchaseOrder.id", "=", "purchaseInvoiceLine.purchaseOrderId")
        .on("purchaseOrder.companyId", "=", companyId)
    )
    .select([
      "purchaseInvoiceLine.invoiceId as invoiceId",
      "purchaseOrder.purchaseOrderId as readableId"
    ])
    .where("purchaseInvoiceLine.companyId", "=", companyId)
    .where("purchaseInvoiceLine.invoiceId", "in", invoiceIds)
    .where("purchaseInvoiceLine.purchaseOrderId", "is not", null)
    .orderBy("purchaseOrder.purchaseOrderId")
    .execute();

  for (const row of rows) {
    if (!row.invoiceId || !row.readableId) continue;
    const existing = result.get(row.invoiceId);
    if (!existing) {
      result.set(row.invoiceId, [row.readableId]);
    } else if (!existing.includes(row.readableId)) {
      existing.push(row.readableId);
    }
  }

  return result;
}

/** Which coding options the platform already knows about. */
export async function loadPushedCoding(
  mappingService: {
    getAllByIntegration: (
      integration: string,
      entityType: string
    ) => Promise<Array<{ entityId: string; externalId?: string | null }>>;
  },
  integration: string,
  options: {
    /**
     * Send the mapped EXTERNAL id instead of the Carbon id.
     *
     * True when the platform's coding options belong to another system (see
     * `SpendPushedCoding`): the mappings are then read from THAT system's
     * integration, and its external id is what the platform knows the option by.
     */
    useExternalIds?: boolean;
  } = {}
): Promise<SpendPushedCoding> {
  const [accounts, costCenters, projects] = await Promise.all([
    mappingService.getAllByIntegration(integration, "account"),
    mappingService.getAllByIntegration(integration, "costCenter"),
    mappingService.getAllByIntegration(integration, "project")
  ]);

  const toMap = (
    rows: Array<{ entityId: string; externalId?: string | null }>
  ) =>
    new Map(
      rows.flatMap((m) => {
        // Carbon's own id is always a usable wire id; a delegated one is only
        // usable if the mapping actually carries the other system's id, so an
        // unmapped row is dropped and its line degrades to uncoded.
        const wireId = options.useExternalIds ? m.externalId : m.entityId;
        return wireId ? [[m.entityId, wireId] as const] : [];
      })
    );

  return {
    pushedAccountIds: toMap(accounts),
    pushedCostCenterIds: toMap(costCenters),
    pushedProjectIds: toMap(projects)
  };
}

/**
 * The posted journal replayed as document-currency lines, with each line's
 * coding resolved to Carbon ids. A platform adapter maps these onto its own
 * line/selection shape and decides what to do with an unpushed option.
 *
 * Throws the structured `UNMAPPED_ACCOUNTS` warning when there is no posted
 * journal to replay (accounting was disabled at post time).
 */
export async function loadBillPushLines(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; billId: string; pushed: SpendPushedCoding }
): Promise<{ lines: SpendBillLine[]; currencyCode: string }> {
  const costing = await loadBillCostingLines(db, {
    companyId: args.companyId,
    billId: args.billId
  });
  const documentLines = toTransactionCurrencyLines(costing.lines, {
    exchangeRate: costing.exchangeRate,
    documentTotal: costing.documentTotal,
    decimalPlaces: costing.decimalPlaces
  });

  return {
    currencyCode: costing.currencyCode,
    lines: documentLines.map((line) => ({
      memo: (line.sourceItem?.name ?? line.description) || undefined,
      amount: line.amount,
      accountId: line.accountId,
      // The cost center / project are the journal-line dimensions whose value is
      // one Carbon has pushed; `valueId` is the costCenter.id / project.id.
      costCenterId:
        line.dimensions?.find((dimension) =>
          args.pushed.pushedCostCenterIds.has(dimension.valueId)
        )?.valueId ?? null,
      projectId:
        line.dimensions?.find((dimension) =>
          args.pushed.pushedProjectIds.has(dimension.valueId)
        )?.valueId ?? null
    }))
  };
}
