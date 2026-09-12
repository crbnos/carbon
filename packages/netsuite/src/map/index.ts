import { bool, date, num, type SuiteQLRow, str } from "../extract/row.ts";
import type { NetSuiteSnapshot } from "../extract/run.ts";
import { type DetectedGap, detectGaps } from "../gaps/index.ts";
import {
  emptyPlan,
  type MigrationPlan,
  type PlanAddress,
  type PlanContact,
  type PlanCustomer,
  type PlanItem,
  type PlanPurchaseOrder,
  type PlanPurchaseOrderLine,
  type PlanSalesOrder,
  type PlanSalesOrderLine,
  type PlanSupplier
} from "../plan.ts";
import { mapAccountType } from "./account-type.ts";
import { mapItemType, UNMIGRATABLE_ITEM_TYPES } from "./item-type.ts";

/**
 * NetSuite's records → Carbon's migration plan.
 *
 * Pure: no network, no database, no clock beyond what the snapshot already
 * recorded. Every product decision about what a NetSuite concept BECOMES in
 * Carbon is made here, once, where it can be read and argued with — rather than
 * scattered through the loader where it would be indistinguishable from a
 * schema constraint.
 */

export type MapResult = {
  plan: MigrationPlan;
  gaps: DetectedGap[];
  /** Things the user should know about how the mapping went, in their language. */
  notes: string[];
};

const CARRIERS = [
  { match: /\bups\b/i, carrier: "UPS" as const },
  { match: /fedex|federal express/i, carrier: "FedEx" as const },
  { match: /usps|postal/i, carrier: "USPS" as const },
  { match: /\bdhl\b/i, carrier: "DHL" as const }
];

function carrierFor(name: string): "UPS" | "FedEx" | "USPS" | "DHL" | "Other" {
  return CARRIERS.find((entry) => entry.match.test(name))?.carrier ?? "Other";
}

/** A party's display name, however NetSuite chose to store it. */
function entityName(row: SuiteQLRow): string {
  const company = str(row, "companyname");
  if (company) return company;
  const first = str(row, "firstname");
  const last = str(row, "lastname");
  const person = [first, last].filter(Boolean).join(" ").trim();
  if (person) return person;
  return str(row, "entityid") ?? `NetSuite ${str(row, "id") ?? "record"}`;
}

/** NetSuite country codes arrive as `_unitedStates`; Carbon wants ISO alpha-2. */
function countryCode(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  // Anything longer is a NetSuite display value or internal key. Rather than
  // ship a 250-row country table for a field nothing branches on, it is left
  // unset — a blank country is visibly missing, a wrong one is not.
  return null;
}

function addressesFor(rows: SuiteQLRow[], entityId: string): PlanAddress[] {
  return rows
    .filter((row) => str(row, "entity_id") === entityId)
    .map((row, index) => ({
      externalId: str(row, "address_id"),
      name:
        str(row, "label") ?? (index === 0 ? "Main" : `Address ${index + 1}`),
      addressLine1: str(row, "addr1"),
      addressLine2: str(row, "addr2"),
      city: str(row, "city"),
      stateProvince: str(row, "state"),
      postalCode: str(row, "zip"),
      countryCode: countryCode(str(row, "country")),
      isDefaultBilling: bool(row, "defaultbilling"),
      isDefaultShipping: bool(row, "defaultshipping")
    }));
}

function contactsFor(rows: SuiteQLRow[], entityId: string): PlanContact[] {
  return rows
    .filter((row) => str(row, "company") === entityId)
    .map((row) => ({
      externalId: String(str(row, "id")),
      firstName: str(row, "firstname"),
      lastName: str(row, "lastname"),
      email: str(row, "email"),
      title: str(row, "title"),
      workPhone: str(row, "officephone") ?? str(row, "phone"),
      mobilePhone: str(row, "mobilephone"),
      // NetSuite contacts carry their own address book rather than pointing at
      // the parent's, so there is nothing reliable to match a location on.
      addressName: null
    }));
}

/** Group the joined header+line rows of a transaction query by transaction id. */
function groupTransactions(rows: SuiteQLRow[]): Map<string, SuiteQLRow[]> {
  const byId = new Map<string, SuiteQLRow[]>();
  for (const row of rows) {
    const id = str(row, "id");
    if (!id) continue;
    const existing = byId.get(id);
    if (existing) existing.push(row);
    else byId.set(id, [row]);
  }
  return byId;
}

export function mapSnapshotToPlan(snapshot: NetSuiteSnapshot): MapResult {
  const notes: string[] = [...snapshot.notes];
  const gapExamples: Record<string, string[]> = {};

  const plan = emptyPlan({
    system: "netsuite",
    accountId: snapshot.accountId,
    extractedAt: snapshot.extractedAt,
    sandbox: snapshot.sandbox
  });

  // ── Currencies ────────────────────────────────────────────────────────────
  for (const row of snapshot.currencies) {
    // `symbol` is NetSuite's ISO code column; `displaysymbol` is the glyph.
    const code = str(row, "symbol");
    const id = str(row, "id");
    if (!code || !id) continue;
    plan.currencies.push({
      externalId: id,
      code: code.toUpperCase(),
      name: str(row, "name") ?? code,
      decimalPlaces: num(row, "currencyprecision") ?? 2,
      active: !bool(row, "isinactive")
    });
  }

  // ── Units of measure ──────────────────────────────────────────────────────
  // NetSuite units exist only INSIDE a units type, so two types can each define
  // "Each". Carbon's unit codes are unique per company, so the first definition
  // of a code wins and the rest collapse onto it.
  const seenUnitCodes = new Set<string>();
  for (const row of snapshot.unitsOfMeasure) {
    const id = str(row, "id");
    const code = str(row, "abbreviation") ?? str(row, "unitname");
    if (!id || !code) continue;
    const key = code.trim().toLowerCase();
    if (seenUnitCodes.has(key)) continue;
    seenUnitCodes.add(key);
    plan.unitsOfMeasure.push({
      externalId: id,
      code: code.trim(),
      name: str(row, "unitname") ?? code.trim()
    });
  }

  if (plan.unitsOfMeasure.length === 0) {
    // No units-of-measure table resolved. Derive the set actually in use from
    // the items themselves, so order lines and BOMs still have units to point at.
    const derived = new Set<string>();
    for (const row of snapshot.items) {
      for (const key of ["stock_unit", "purchase_unit", "sale_unit"]) {
        const value = str(row, key);
        if (value) derived.add(value.trim());
      }
    }
    for (const code of derived) {
      plan.unitsOfMeasure.push({
        externalId: `derived:${code}`,
        code,
        name: code
      });
    }
    if (derived.size > 0) {
      notes.push(
        `${derived.size} units of measure were derived from the items, because this account's unit tables could not be read.`
      );
    }
  }

  // ── Payment terms ─────────────────────────────────────────────────────────
  for (const row of snapshot.paymentTerms) {
    const id = str(row, "id");
    const name = str(row, "name");
    if (!id || !name) continue;
    if (bool(row, "isinactive")) continue;

    const dateDriven = bool(row, "datedriven");
    plan.paymentTerms.push({
      externalId: id,
      name,
      daysDue: dateDriven
        ? (num(row, "dayofmonthnetdue") ?? 0)
        : (num(row, "daysuntilnetdue") ?? 0),
      daysDiscount: num(row, "daydiscountexpires") ?? 0,
      discountPercentage: num(row, "discountpercent") ?? 0,
      calculationMethod: dateDriven ? "Day of Month" : "Net"
    });
  }

  // ── Shipping methods ──────────────────────────────────────────────────────
  for (const row of snapshot.shippingMethods) {
    const id = str(row, "id");
    const name = str(row, "displayname") ?? str(row, "itemid");
    if (!id || !name) continue;
    if (bool(row, "isinactive")) continue;
    plan.shippingMethods.push({
      externalId: id,
      name,
      carrier: carrierFor(name)
    });
  }

  // ── Locations ─────────────────────────────────────────────────────────────
  for (const row of snapshot.locations) {
    const id = str(row, "id");
    const name = str(row, "name");
    if (!id || !name) continue;
    if (bool(row, "isinactive")) continue;
    plan.locations.push({
      externalId: id,
      name,
      code: str(row, "tranprefix"),
      addressLine1: str(row, "addr1") ?? "",
      addressLine2: str(row, "addr2"),
      city: str(row, "city") ?? "",
      stateProvince: str(row, "state"),
      postalCode: str(row, "zip") ?? "",
      countryCode: countryCode(str(row, "country"))
    });
  }

  // ── Departments ───────────────────────────────────────────────────────────
  for (const row of snapshot.departments) {
    const id = str(row, "id");
    const name = str(row, "name");
    if (!id || !name) continue;
    if (bool(row, "isinactive")) continue;
    plan.departments.push({
      externalId: id,
      name,
      parentExternalId: str(row, "parent")
    });
  }

  // ── Chart of accounts ─────────────────────────────────────────────────────
  let skippedAccounts = 0;
  for (const row of snapshot.accounts) {
    const id = str(row, "id");
    const name = str(row, "name") ?? str(row, "fullname");
    if (!id || !name) continue;

    const classification = mapAccountType(str(row, "accttype"));
    if (!classification) {
      // Non-posting and statistical accounts have no Carbon counterpart.
      skippedAccounts += 1;
      continue;
    }

    plan.accounts.push({
      externalId: id,
      number: str(row, "acctnumber"),
      name,
      class: classification.class,
      incomeBalance: classification.incomeBalance,
      accountType: classification.accountType,
      isGroup: bool(row, "issummary"),
      parentExternalId: str(row, "parent"),
      active: !bool(row, "isinactive")
    });
  }
  if (skippedAccounts > 0) {
    gapExamples["NS-ACC-004"] = [
      `${skippedAccounts} non-posting or statistical accounts were skipped`
    ];
  }

  // ── Party categories ──────────────────────────────────────────────────────
  for (const row of snapshot.customerCategories) {
    const id = str(row, "id");
    const name = str(row, "name");
    if (id && name) plan.customerTypes.push({ externalId: id, name });
  }
  for (const row of snapshot.vendorCategories) {
    const id = str(row, "id");
    const name = str(row, "name");
    if (id && name) plan.supplierTypes.push({ externalId: id, name });
  }

  // ── Customers ─────────────────────────────────────────────────────────────
  for (const row of snapshot.customers) {
    const id = str(row, "id");
    if (!id) continue;

    const customer: PlanCustomer = {
      externalId: id,
      name: entityName(row),
      readableId: str(row, "entityid"),
      phone: str(row, "phone"),
      fax: str(row, "fax"),
      website: str(row, "url"),
      currencyCode: str(row, "currency_code"),
      // NetSuite's effective tax rate lives in a tax code or a SuiteTax nexus,
      // neither of which is a single number on the customer. Carbon's per-customer
      // rate is left at zero for the user to set — see gap NS-ACC-006.
      taxPercent: 0,
      taxId: null,
      typeName: str(row, "category_name"),
      // NetSuite's entity statuses are CRM stages ("Customer-Closed Won") that
      // do not correspond to Carbon's statuses, so the only honest signal is
      // whether the record is active.
      statusName: bool(row, "isinactive") ? "Inactive" : "Active",
      paymentTermName: str(row, "terms_name"),
      shippingMethodName: str(row, "shipping_method_name"),
      addresses: addressesFor(snapshot.customerAddresses, id),
      contacts: contactsFor(snapshot.contacts, id)
    };
    plan.customers.push(customer);
  }

  // ── Suppliers ─────────────────────────────────────────────────────────────
  for (const row of snapshot.vendors) {
    const id = str(row, "id");
    if (!id) continue;

    const supplier: PlanSupplier = {
      externalId: id,
      name: str(row, "legalname") ?? entityName(row),
      readableId: str(row, "entityid"),
      phone: str(row, "phone"),
      fax: str(row, "fax"),
      website: str(row, "url"),
      currencyCode: str(row, "currency_code"),
      taxId: null,
      typeName: str(row, "category_name"),
      status: bool(row, "isinactive") ? "Inactive" : "Active",
      paymentTermName: str(row, "terms_name"),
      shippingMethodName: null,
      addresses: addressesFor(snapshot.vendorAddresses, id),
      contacts: contactsFor(snapshot.contacts, id)
    };
    plan.suppliers.push(supplier);
  }

  // ── Items ─────────────────────────────────────────────────────────────────
  const basePriceByItem = new Map<string, number>();
  for (const row of snapshot.itemPrices) {
    const item = str(row, "item");
    const price = num(row, "unitprice");
    const qtyBreak = num(row, "qty_break") ?? 0;
    // The base price is the level's price at quantity 0/1; higher breaks are a
    // pricing rule Carbon authors separately (gap NS-ITM-003).
    if (!item || price === null || qtyBreak > 1) continue;
    if (!basePriceByItem.has(item)) basePriceByItem.set(item, price);
  }

  const skippedItemTypes = new Map<string, number>();
  const migratedItemIds = new Set<string>();

  for (const row of snapshot.items) {
    const id = str(row, "id");
    const readableId = str(row, "itemid");
    const netsuiteType = str(row, "itemtype") ?? "";
    if (!id || !readableId) continue;

    const mapping = mapItemType(netsuiteType, {
      isLot: bool(row, "islotitem"),
      isSerial: bool(row, "isserialitem")
    });

    if (!mapping) {
      skippedItemTypes.set(
        netsuiteType,
        (skippedItemTypes.get(netsuiteType) ?? 0) + 1
      );
      continue;
    }

    const item: PlanItem = {
      externalId: id,
      readableId,
      // Carbon versions items by revision and NetSuite does not, so everything
      // lands at revision 0 — which is what every migrated BOM and order line
      // then points at.
      revision: "0",
      name: str(row, "displayname") ?? readableId,
      description: str(row, "salesdescription") ?? str(row, "description"),
      type: mapping.type,
      itemTrackingType: mapping.itemTrackingType,
      replenishmentSystem: mapping.replenishmentSystem,
      defaultMethodType: mapping.defaultMethodType,
      unitOfMeasureCode: str(row, "stock_unit") ?? "EA",
      purchasingUnitOfMeasureCode: str(row, "purchase_unit"),
      salesUnitOfMeasureCode: str(row, "sale_unit"),
      // `cost` is the item's standard/purchase cost; `averagecost` is what the
      // ledger actually holds. Carbon's unit cost is the moving one, its
      // standard cost the planned one — so they come from different columns.
      unitCost: num(row, "averagecost") ?? num(row, "lastpurchaseprice"),
      standardCost: num(row, "cost"),
      unitSalePrice: basePriceByItem.get(id) ?? null,
      leadTime: null,
      mpn: str(row, "mpn"),
      active: !bool(row, "isinactive"),
      sourceRecordType: netsuiteType
    };

    plan.items.push(item);
    migratedItemIds.add(id);
  }

  if (skippedItemTypes.size > 0) {
    const detail = [...skippedItemTypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${count}× ${type}`);
    gapExamples["NS-ITM-002"] = detail;
    const unknown = [...skippedItemTypes.keys()].filter(
      (type) => !UNMIGRATABLE_ITEM_TYPES.has(type)
    );
    if (unknown.length > 0) {
      notes.push(
        `These NetSuite item types were not recognized and were skipped: ${unknown.join(", ")}.`
      );
    }
  }

  // ── Supplier parts ────────────────────────────────────────────────────────
  for (const row of snapshot.itemVendors) {
    const item = str(row, "item");
    const vendor = str(row, "vendor");
    if (!item || !vendor) continue;
    if (!migratedItemIds.has(item)) continue;

    plan.supplierParts.push({
      externalId: `${item}:${vendor}`,
      itemExternalId: item,
      supplierExternalId: vendor,
      supplierPartId: str(row, "vendorcode"),
      unitPrice: num(row, "purchaseprice"),
      conversionFactor: 1,
      minimumOrderQuantity: null
    });
  }

  // ── Bills of material ─────────────────────────────────────────────────────
  const bomByAssembly = new Map<
    string,
    { externalId: string; lines: SuiteQLRow[] }
  >();
  for (const row of snapshot.bomLines) {
    const assembly = str(row, "assembly_item_id");
    if (!assembly) continue;
    const existing = bomByAssembly.get(assembly);
    if (existing) existing.lines.push(row);
    else
      bomByAssembly.set(assembly, {
        externalId: str(row, "revision_id") ?? `bom:${assembly}`,
        lines: [row]
      });
  }

  for (const [assembly, bom] of bomByAssembly) {
    if (!migratedItemIds.has(assembly)) continue;

    const lines = bom.lines
      .map((row, index) => {
        const component = str(row, "component_item_id");
        if (!component || !migratedItemIds.has(component)) return null;
        // `bomquantity` is stated in the revision line's own unit; `quantity` is
        // in the item's base unit. Carbon's methodMaterial quantity is in the
        // component's unit of measure, which is the base unit we imported — so
        // `quantity` is the correct column and mixing them rescales the BOM.
        const quantity = num(row, "qty_per");
        if (quantity === null || quantity <= 0) return null;
        return {
          componentItemExternalId: component,
          quantity,
          order: num(row, "line_no") ?? index + 1,
          scrapPercentage: null
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);

    if (lines.length === 0) continue;
    plan.billsOfMaterial.push({
      externalId: bom.externalId,
      parentItemExternalId: assembly,
      lines
    });
  }

  // ── Opening stock ─────────────────────────────────────────────────────────
  for (const row of snapshot.inventoryBalances) {
    const item = str(row, "item");
    const quantity = num(row, "quantityonhand");
    if (!item || quantity === null || quantity <= 0) continue;
    if (!migratedItemIds.has(item)) continue;

    plan.openingStock.push({
      itemExternalId: item,
      locationExternalId: str(row, "location"),
      quantity,
      unitCost: num(row, "averagecost")
    });
  }

  // ── Open sales orders ─────────────────────────────────────────────────────
  let undatedOrders = 0;
  for (const [id, rows] of groupTransactions(snapshot.salesOrderLines)) {
    const header = rows[0];
    if (!header) continue;
    const customer = str(header, "entity");
    const tranId = str(header, "tranid");
    if (!customer || !tranId) continue;

    const orderDate = date(header, "trandate");
    if (orderDate === null && str(header, "trandate") !== null)
      undatedOrders += 1;

    const lines: PlanSalesOrderLine[] = rows.map((row, index) => {
      const item = str(row, "item");
      return {
        externalId: str(row, "line_id") ?? `${id}:${index}`,
        itemExternalId: item && migratedItemIds.has(item) ? item : null,
        description: str(row, "line_memo"),
        quantity: num(row, "quantity") ?? 0,
        quantityShipped: num(row, "quantityshiprecv") ?? 0,
        unitPrice: num(row, "rate"),
        unitOfMeasureCode: str(row, "unit_name"),
        promisedDate: date(row, "expectedshipdate"),
        taxPercent: 0,
        isComment: !item
      };
    });

    const order: PlanSalesOrder = {
      externalId: id,
      salesOrderId: tranId,
      customerExternalId: customer,
      customerReference: str(header, "otherrefnum"),
      currencyCode: str(header, "currency_code"),
      exchangeRate: num(header, "exchangerate"),
      orderDate,
      locationExternalId: str(header, "location"),
      shippingMethodName: null,
      paymentTermName: str(header, "terms_name"),
      lines
    };
    plan.salesOrders.push(order);
  }

  // ── Open purchase orders ──────────────────────────────────────────────────
  for (const [id, rows] of groupTransactions(snapshot.purchaseOrderLines)) {
    const header = rows[0];
    if (!header) continue;
    const supplier = str(header, "entity");
    const tranId = str(header, "tranid");
    if (!supplier || !tranId) continue;

    const orderDate = date(header, "trandate");
    if (orderDate === null && str(header, "trandate") !== null)
      undatedOrders += 1;

    const lines: PlanPurchaseOrderLine[] = rows.map((row, index) => {
      const item = str(row, "item");
      return {
        externalId: str(row, "line_id") ?? `${id}:${index}`,
        itemExternalId: item && migratedItemIds.has(item) ? item : null,
        description: str(row, "line_memo"),
        quantity: num(row, "quantity") ?? 0,
        quantityReceived: num(row, "quantityshiprecv") ?? 0,
        unitPrice: num(row, "rate"),
        unitOfMeasureCode: str(row, "unit_name"),
        promisedDate: date(row, "expectedreceiptdate"),
        isComment: !item
      };
    });

    const order: PlanPurchaseOrder = {
      externalId: id,
      purchaseOrderId: tranId,
      supplierExternalId: supplier,
      supplierReference: str(header, "otherrefnum"),
      currencyCode: str(header, "currency_code"),
      exchangeRate: num(header, "exchangerate"),
      orderDate,
      locationExternalId: str(header, "location"),
      shippingMethodName: null,
      paymentTermName: str(header, "terms_name"),
      lines
    };
    plan.purchaseOrders.push(order);
  }

  if (undatedOrders > 0) {
    notes.push(
      `${undatedOrders} orders arrived with a date this account formats ambiguously (DD/MM vs MM/DD), so their order date was left blank rather than guessed.`
    );
  }

  const gaps = detectGaps({
    counts: snapshot.gapCounts,
    examples: gapExamples
  });

  return { plan, gaps, notes };
}

export { type AccountClassification, mapAccountType } from "./account-type.ts";
export {
  type ItemTypeMapping,
  mapItemType,
  UNMIGRATABLE_ITEM_TYPES
} from "./item-type.ts";
