import { isSandboxAccount } from "../client/account.ts";
import type { NetSuiteClient } from "../client/client.ts";
import { type AccountProbe, probeAccount } from "./probe.ts";
import type { SuiteQLRow } from "./row.ts";
import { keysetPredicate, sqlId } from "./sql.ts";

/**
 * The raw NetSuite side of a migration — every row the mapper needs, in
 * NetSuite's own shape and vocabulary.
 *
 * SuiteQL does 95% of the reading, not the REST record service: a collection GET
 * on `/record/v1/customer` returns only ids and links, so reading 4,000 customers
 * that way is 4,001 requests against an account whose whole concurrency
 * allotment is 5. The same read in SuiteQL is 4 requests.
 */
export type NetSuiteSnapshot = {
  accountId: string;
  sandbox: boolean;
  extractedAt: string;
  subsidiaryId: string | null;
  probe: AccountProbe;

  currencies: SuiteQLRow[];
  unitsOfMeasure: SuiteQLRow[];
  paymentTerms: SuiteQLRow[];
  shippingMethods: SuiteQLRow[];
  locations: SuiteQLRow[];
  departments: SuiteQLRow[];
  accounts: SuiteQLRow[];
  customerCategories: SuiteQLRow[];
  vendorCategories: SuiteQLRow[];
  customers: SuiteQLRow[];
  customerAddresses: SuiteQLRow[];
  vendors: SuiteQLRow[];
  vendorAddresses: SuiteQLRow[];
  contacts: SuiteQLRow[];
  items: SuiteQLRow[];
  itemVendors: SuiteQLRow[];
  itemPrices: SuiteQLRow[];
  bomLines: SuiteQLRow[];
  inventoryBalances: SuiteQLRow[];
  /** Header columns repeated per line; the mapper groups them by `id`. */
  salesOrderLines: SuiteQLRow[];
  purchaseOrderLines: SuiteQLRow[];

  /** Gap id → how many source records it leaves behind. Feeds `detectGaps`. */
  gapCounts: Record<string, number>;
  /** Things worth telling the user about how the extract itself went. */
  notes: string[];
};

export type ExtractOptions = {
  /**
   * Which OneWorld subsidiary to migrate. Required when the account has more
   * than one migratable subsidiary — merging them into a single Carbon company
   * double-counts every intercompany transaction.
   */
  subsidiaryId?: string | null;
  /** Guard rail per table. A migration should be bounded, not a runaway. */
  maxRowsPerTable?: number;
  onProgress?: (progress: {
    phase: string;
    done: number;
    total: number;
  }) => Promise<void>;
  log?: (message: string) => void;
};

const DEFAULT_MAX_ROWS = 100_000;

/** Raised when the account needs a decision the extractor must not make for the user. */
export class SubsidiaryChoiceRequired extends Error {
  readonly subsidiaries: AccountProbe["subsidiaries"];

  constructor(subsidiaries: AccountProbe["subsidiaries"]) {
    super(
      `This NetSuite account has ${subsidiaries.length} subsidiaries. Pick the one to migrate — merging them into one company double-counts intercompany revenue and inventory.`
    );
    this.name = "SubsidiaryChoiceRequired";
    this.subsidiaries = subsidiaries;
  }
}

export async function extractNetSuite(
  client: NetSuiteClient,
  accountId: string,
  options: ExtractOptions = {}
): Promise<NetSuiteSnapshot> {
  const log =
    options.log ??
    (() => {
      /* the caller did not want a log */
    });
  const maxRows = options.maxRowsPerTable ?? DEFAULT_MAX_ROWS;
  const notes: string[] = [];
  const gapCounts: Record<string, number> = {};

  log("Reading the account's shape");
  const probe = await probeAccount(client);
  notes.push(...probe.notes);

  const migratable = probe.subsidiaries.filter(
    (s) => !s.isElimination && !s.isInactive
  );
  let subsidiaryId: string | null = options.subsidiaryId ?? null;

  if (probe.oneWorld) {
    if (subsidiaryId === null && migratable.length > 1) {
      throw new SubsidiaryChoiceRequired(migratable);
    }
    if (subsidiaryId === null) subsidiaryId = migratable[0]?.id ?? null;
    if (
      subsidiaryId !== null &&
      !probe.subsidiaries.some((s) => s.id === subsidiaryId)
    ) {
      throw new Error(
        `Subsidiary ${subsidiaryId} is not in this NetSuite account`
      );
    }
  } else if (subsidiaryId !== null) {
    notes.push(
      "This account is not OneWorld, so the chosen subsidiary was ignored."
    );
    subsidiaryId = null;
  }

  /** `AND <column> = <id>` — empty when the account has no subsidiaries at all. */
  const bySubsidiary = (column: string): string =>
    subsidiaryId === null ? "" : `AND ${column} = ${sqlId(subsidiaryId)}`;

  const rows = (q: string) => client.suiteQLRows<SuiteQLRow>(q, { maxRows });
  const keyset = (build: (afterId: string | null) => string) =>
    client.suiteQLKeysetRows<SuiteQLRow>(build, { maxRows });

  /** A COUNT(*) that answers a gap question, and never fails the migration. */
  const countFor = async (gapId: string, q: string): Promise<void> => {
    try {
      const result = await client.suiteQL<SuiteQLRow>(q, { limit: 5 });
      const first = result.items[0];
      const value = first ? Number(Object.values(first)[0]) : 0;
      gapCounts[gapId] = Number.isFinite(value) ? value : 0;
    } catch {
      // No count means "we could not check", which `detectGaps` reports as an
      // uncounted gap — deliberately NOT the same as zero.
    }
  };

  const steps: { phase: string; run: () => Promise<void> }[] = [];
  const snapshot: NetSuiteSnapshot = {
    accountId,
    sandbox: isSandboxAccount(accountId),
    extractedAt: new Date().toISOString(),
    subsidiaryId,
    probe,
    currencies: [],
    unitsOfMeasure: [],
    paymentTerms: [],
    shippingMethods: [],
    locations: [],
    departments: [],
    accounts: [],
    customerCategories: [],
    vendorCategories: [],
    customers: [],
    customerAddresses: [],
    vendors: [],
    vendorAddresses: [],
    contacts: [],
    items: [],
    itemVendors: [],
    itemPrices: [],
    bomLines: [],
    inventoryBalances: [],
    salesOrderLines: [],
    purchaseOrderLines: [],
    gapCounts,
    notes
  };

  steps.push({
    phase: "currencies",
    run: async () => {
      snapshot.currencies = await rows(
        `SELECT c.id, c.symbol, c.name, c.currencyprecision, c.isinactive
         FROM currency c
         ORDER BY c.id`
      );
    }
  });

  steps.push({
    phase: "units",
    run: async () => {
      if (!probe.unitsOfMeasureTable) return;
      snapshot.unitsOfMeasure = await rows(
        `SELECT u.internalid AS id, u.unitname, u.abbreviation, u.conversionrate,
                u.isbaseunit, u.unitstype
         FROM ${probe.unitsOfMeasureTable} u
         ORDER BY u.internalid`
      );
    }
  });

  steps.push({
    phase: "terms",
    run: async () => {
      snapshot.paymentTerms = await rows(
        `SELECT t.id, t.name, t.daysuntilnetdue, t.discountpercent, t.daydiscountexpires,
                t.dayofmonthnetdue, t.datedriven, t.isinactive
         FROM term t
         ORDER BY t.id`
      );
    }
  });

  steps.push({
    phase: "shipping",
    run: async () => {
      snapshot.shippingMethods = await rows(
        `SELECT s.id, s.itemid, s.displayname, s.description, s.isinactive
         FROM shipitem s
         ORDER BY s.id`
      );
    }
  });

  steps.push({
    phase: "locations",
    run: async () => {
      snapshot.locations = await rows(
        `SELECT l.id, l.name, l.tranprefix, l.isinactive,
                l.city, l.state, l.zip, l.country, l.addr1, l.addr2
         FROM location l
         WHERE 1 = 1 ${probe.oneWorld ? bySubsidiary("l.subsidiary") : ""}
         ORDER BY l.id`
      );
    }
  });

  steps.push({
    phase: "departments",
    run: async () => {
      snapshot.departments = await rows(
        `SELECT d.id, d.name, d.parent, d.isinactive
         FROM department d
         ORDER BY d.id`
      );
    }
  });

  steps.push({
    phase: "accounts",
    run: async () => {
      snapshot.accounts = await rows(
        `SELECT a.id, a.acctnumber, a.accountsearchdisplayname AS name, a.fullname,
                a.accttype, a.parent, a.issummary, a.isinactive, a.description
         FROM account a
         ORDER BY a.id`
      );
    }
  });

  steps.push({
    phase: "categories",
    run: async () => {
      snapshot.customerCategories = await rows(
        `SELECT c.id, c.name FROM customercategory c ORDER BY c.id`
      ).catch(() => []);
      snapshot.vendorCategories = await rows(
        `SELECT v.id, v.name FROM vendorcategory v ORDER BY v.id`
      ).catch(() => []);
    }
  });

  steps.push({
    phase: "customers",
    run: async () => {
      snapshot.customers = await keyset(
        (afterId) => `
        SELECT c.id, c.entityid, c.companyname, c.isperson, c.firstname, c.lastname,
               c.email, c.phone, c.fax, c.url, c.isinactive,
               BUILTIN.DF(c.category) AS category_name,
               BUILTIN.DF(c.terms) AS terms_name,
               BUILTIN.DF(c.currency) AS currency_code,
               BUILTIN.DF(c.shippingitem) AS shipping_method_name,
               c.taxable, c.externalid
        FROM customer c
        WHERE ${keysetPredicate("c.id", afterId)} ${probe.oneWorld ? bySubsidiary("c.subsidiary") : ""}
        ORDER BY c.id`
      );

      if (probe.addressTables) {
        const { book, address, entityColumn } = probe.addressTables;
        snapshot.customerAddresses = await rows(
          `SELECT ab.${entityColumn} AS entity_id, ab.defaultbilling, ab.defaultshipping,
                  ab.label, ab.addressbookaddress AS address_id,
                  a.addr1, a.addr2, a.city, a.state, a.zip, a.country
           FROM customer c
           JOIN ${book} ab ON ab.${entityColumn} = c.id
           LEFT JOIN ${address} a ON a.nkey = ab.addressbookaddress
           WHERE 1 = 1 ${probe.oneWorld ? bySubsidiary("c.subsidiary") : ""}
           ORDER BY ab.${entityColumn}`
        ).catch((error: unknown) => {
          notes.push(
            `Customer addresses could not be read (${error instanceof Error ? error.message : "unknown error"}).`
          );
          return [];
        });
      }
    }
  });

  steps.push({
    phase: "suppliers",
    run: async () => {
      snapshot.vendors = await keyset(
        (afterId) => `
        SELECT v.id, v.entityid, v.companyname, v.legalname, v.isperson,
               v.firstname, v.lastname, v.email, v.phone, v.fax, v.url, v.isinactive,
               BUILTIN.DF(v.category) AS category_name,
               BUILTIN.DF(v.terms) AS terms_name,
               BUILTIN.DF(v.currency) AS currency_code,
               v.externalid
        FROM vendor v
        WHERE ${keysetPredicate("v.id", afterId)} ${probe.oneWorld ? bySubsidiary("v.subsidiary") : ""}
        ORDER BY v.id`
      );

      if (probe.addressTables) {
        // The vendor address book is the record-scoped twin of the customer one
        // on 2026.1+, and the same shared table before it.
        const book = probe.addressTables.book.replace(/^customer/, "vendor");
        const address = probe.addressTables.address.replace(
          /^customer/,
          "vendor"
        );
        snapshot.vendorAddresses = await rows(
          `SELECT ab.entity AS entity_id, ab.defaultbilling, ab.defaultshipping,
                  ab.label, ab.addressbookaddress AS address_id,
                  a.addr1, a.addr2, a.city, a.state, a.zip, a.country
           FROM vendor v
           JOIN ${book} ab ON ab.entity = v.id
           LEFT JOIN ${address} a ON a.nkey = ab.addressbookaddress
           WHERE 1 = 1 ${probe.oneWorld ? bySubsidiary("v.subsidiary") : ""}
           ORDER BY ab.entity`
        ).catch((error: unknown) => {
          notes.push(
            `Supplier addresses could not be read (${error instanceof Error ? error.message : "unknown error"}).`
          );
          return [];
        });
      }
    }
  });

  steps.push({
    phase: "contacts",
    run: async () => {
      snapshot.contacts = await keyset(
        (afterId) => `
        SELECT ct.id, ct.firstname, ct.lastname, ct.title, ct.email,
               ct.phone, ct.mobilephone, ct.officephone, ct.company, ct.isinactive
        FROM contact ct
        WHERE ${keysetPredicate("ct.id", afterId)} ${probe.oneWorld ? bySubsidiary("ct.subsidiary") : ""}
        ORDER BY ct.id`
      );
    }
  });

  steps.push({
    phase: "items",
    run: async () => {
      snapshot.items = await keyset(
        (afterId) => `
        SELECT i.id, i.itemid, i.displayname, i.itemtype, i.description, i.salesdescription,
               i.purchasedescription, i.mpn, i.isinactive, i.isserialitem, i.islotitem,
               BUILTIN.DF(i.stockunit) AS stock_unit,
               BUILTIN.DF(i.purchaseunit) AS purchase_unit,
               BUILTIN.DF(i.saleunit) AS sale_unit,
               i.cost, i.lastpurchaseprice, i.averagecost, i.totalquantityonhand,
               i.costingmethod, i.externalid
        FROM item i
        WHERE ${keysetPredicate("i.id", afterId)}
        ORDER BY i.id`
      );

      snapshot.itemVendors = await rows(
        `SELECT iv.item, iv.vendor, iv.vendorcode, iv.purchaseprice, iv.preferredvendor
         FROM itemvendor iv
         ORDER BY iv.item`
      ).catch(() => []);

      snapshot.itemPrices = await rows(
        `SELECT p.item, p.pricelevel, BUILTIN.DF(p.pricelevel) AS price_level_name,
                p.quantity AS qty_break, p.unitprice
         FROM pricing p
         ORDER BY p.item`
      ).catch(() => []);
    }
  });

  steps.push({
    phase: "boms",
    run: async () => {
      if (!probe.bomComponentTable) return;
      snapshot.bomLines = await rows(
        `SELECT a.id AS assembly_item_id, b.id AS bom_id, br.id AS revision_id,
                brc.linenumber AS line_no, brc.item AS component_item_id,
                brc.quantity AS qty_per, brc.bomquantity, brc.componentyield, brc.units
         FROM item a
         JOIN bomassembly ba ON ba.assembly = a.id
         JOIN bom b ON b.id = ba.billofmaterials
         JOIN bomrevision br ON br.billofmaterials = b.id
         JOIN ${probe.bomComponentTable} brc ON brc.bomrevision = br.id
         WHERE a.itemtype = 'Assembly'
           AND br.isinactive = 'F'
           AND (br.effectivedate IS NULL OR br.effectivedate <= CURRENT_DATE)
           AND (br.obsoletedate IS NULL OR br.obsoletedate > CURRENT_DATE)
         ORDER BY a.id`
      ).catch((error: unknown) => {
        notes.push(
          `Bills of material could not be read (${error instanceof Error ? error.message : "unknown error"}).`
        );
        return [];
      });
    }
  });

  steps.push({
    phase: "inventory",
    run: async () => {
      if (probe.inventoryTable === "inventorybalance") {
        snapshot.inventoryBalances = await rows(
          `SELECT ib.item, ib.location, ib.quantityonhand
           FROM inventorybalance ib
           ORDER BY ib.item`
        );
        return;
      }
      if (probe.inventoryTable === "inventoryitemlocations") {
        snapshot.inventoryBalances = await rows(
          `SELECT il.item, il.location, il.quantityonhand, il.averagecost
           FROM inventoryitemlocations il
           ORDER BY il.item`
        );
        return;
      }
      snapshot.inventoryBalances = await rows(
        `SELECT i.id AS item, NULL AS location, i.totalquantityonhand AS quantityonhand,
                i.averagecost
         FROM item i
         WHERE i.itemtype IN ('InvtPart', 'Assembly')
         ORDER BY i.id`
      );
    }
  });

  steps.push({
    phase: "salesOrders",
    run: async () => {
      // Only OPEN orders: `tl.isclosed = 'F'` drops fulfilled lines, and the
      // status filter drops the orders NetSuite itself considers finished.
      snapshot.salesOrderLines = await rows(
        `SELECT t.id, t.tranid, t.trandate, t.status, t.entity, t.currency,
                BUILTIN.DF(t.currency) AS currency_code, t.exchangerate, t.otherrefnum,
                BUILTIN.DF(t.terms) AS terms_name, t.location,
                tl.id AS line_id, tl.linesequencenumber, tl.item, tl.memo AS line_memo,
                tl.quantity, tl.quantityshiprecv, tl.rate, tl.units,
                BUILTIN.DF(tl.units) AS unit_name, tl.expectedshipdate, tl.isclosed
         FROM transaction t
         JOIN transactionline tl ON tl.transaction = t.id
         WHERE t.type = 'SalesOrd'
           AND tl.mainline = 'F'
           AND tl.taxline = 'F'
           AND tl.isclosed = 'F'
           AND t.status NOT IN ('SalesOrd:H', 'SalesOrd:C', 'SalesOrd:G')
           ${probe.oneWorld ? bySubsidiary("t.subsidiary") : ""}
         ORDER BY t.id`
      );
    }
  });

  steps.push({
    phase: "purchaseOrders",
    run: async () => {
      snapshot.purchaseOrderLines = await rows(
        `SELECT t.id, t.tranid, t.trandate, t.status, t.entity, t.currency,
                BUILTIN.DF(t.currency) AS currency_code, t.exchangerate, t.otherrefnum,
                BUILTIN.DF(t.terms) AS terms_name, t.location,
                tl.id AS line_id, tl.linesequencenumber, tl.item, tl.memo AS line_memo,
                tl.quantity, tl.quantityshiprecv, tl.rate, tl.units,
                BUILTIN.DF(tl.units) AS unit_name, tl.expectedreceiptdate, tl.isclosed
         FROM transaction t
         JOIN transactionline tl ON tl.transaction = t.id
         WHERE t.type = 'PurchOrd'
           AND tl.mainline = 'F'
           AND tl.taxline = 'F'
           AND tl.isclosed = 'F'
           AND t.status NOT IN ('PurchOrd:H', 'PurchOrd:G')
           ${probe.oneWorld ? bySubsidiary("t.subsidiary") : ""}
         ORDER BY t.id`
      );
    }
  });

  steps.push({
    phase: "gaps",
    run: async () => {
      await countFor(
        "NS-ACC-002",
        `SELECT COUNT(*) AS c FROM transaction t WHERE t.type IN ('CustInvc','VendBill','CustCred','VendCred') AND t.status NOT IN ('CustInvc:B','VendBill:B')`
      );
      await countFor(
        "NS-ACC-001",
        `SELECT COUNT(*) AS c FROM transaction t WHERE t.type = 'Journal'`
      );
      await countFor(
        "NS-MFG-003",
        `SELECT COUNT(*) AS c FROM transaction t WHERE t.type = 'WorkOrd' AND t.status NOT IN ('WorkOrd:H','WorkOrd:G')`
      );
      await countFor(
        "NS-INV-002",
        `SELECT COUNT(*) AS c FROM item i WHERE i.islotitem = 'T' OR i.isserialitem = 'T'`
      );
      await countFor(
        "NS-ITM-002",
        `SELECT COUNT(*) AS c FROM item i WHERE i.itemtype IN ('Kit','Group')`
      );
      await countFor(
        "NS-SLS-001",
        `SELECT COUNT(*) AS c FROM transaction t WHERE t.type IN ('Estimate','RtnAuth','ItemShip')`
      );
      await countFor(
        "NS-PUR-001",
        `SELECT COUNT(*) AS c FROM transaction t WHERE t.type IN ('ItemRcpt','VendAuth')`
      );
      await countFor(
        "NS-PLT-005",
        `SELECT COUNT(*) AS c FROM employee e WHERE e.isinactive = 'F'`
      );
      await countFor(
        "NS-ACC-003",
        `SELECT COUNT(*) AS c FROM accountingperiod`
      );
      await countFor(
        "NS-ACC-007",
        `SELECT COUNT(*) AS c FROM transaction t WHERE t.type = 'Deprecation'`
      );
      // A single-subsidiary account has no OneWorld problem to report.
      gapCounts["NS-PLT-001"] = probe.oneWorld
        ? Math.max(migratable.length - 1, 0)
        : 0;
    }
  });

  await options.onProgress?.({
    phase: "extract",
    done: 0,
    total: steps.length
  });
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step) continue;
    log(`Reading ${step.phase} from NetSuite`);
    await step.run();
    await options.onProgress?.({
      phase: "extract",
      done: i + 1,
      total: steps.length
    });
  }

  return snapshot;
}
