// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * A related name copied onto the index row: `field` is set to `table.column`
 * of the row whose `matchOn` (default `id`) equals `record[from]`. The read is
 * limited to the record's company unless the table is `global` (has no
 * companyId).
 */
export type SearchLookup = {
  field: string;
  table: string;
  column: string;
  from: string;
  matchOn?: string;
  global?: true;
};

// Configuration for each entity type's search indexing
export type SearchEntityConfig = {
  entityType: string;
  getTitle: (record: Record<string, any>) => string;
  getDescription?: (record: Record<string, any>) => string;
  getLink: (record: Record<string, any>) => string;
  getTags: (record: Record<string, any>) => string[];
  getMetadata: (record: Record<string, any>) => Record<string, any>;
  lookups?: SearchLookup[];
};

// Entity configurations matching the existing sync functions
export const SEARCH_ENTITY_CONFIGS: Record<string, SearchEntityConfig> = {
  employee: {
    entityType: "employee",
    getTitle: (r) => r.fullName || "",
    getLink: (r) => `/x/person/${r.id}`,
    getTags: (r) => [r.employeeTypeName].filter(Boolean),
    getMetadata: (r) => ({ active: r.active }),
    lookups: [
      {
        field: "fullName",
        table: "user",
        column: "fullName",
        from: "id",
        global: true
      },
      {
        field: "employeeTypeName",
        table: "employeeType",
        column: "name",
        from: "employeeTypeId"
      }
    ]
  },
  customer: {
    entityType: "customer",
    getTitle: (r) => r.name,
    getLink: (r) => `/x/customer/${r.id}`,
    getTags: (r) => [r.customerTypeName, r.customerStatusName].filter(Boolean),
    getMetadata: (r) => ({ taxId: r.taxId }),
    lookups: [
      {
        field: "customerTypeName",
        table: "customerType",
        column: "name",
        from: "customerTypeId"
      },
      {
        field: "customerStatusName",
        table: "customerStatus",
        column: "name",
        from: "customerStatusId"
      },
      {
        field: "taxId",
        table: "customerTax",
        column: "taxId",
        from: "id",
        matchOn: "customerId"
      }
    ]
  },
  supplier: {
    entityType: "supplier",
    getTitle: (r) => r.name,
    getLink: (r) => `/x/supplier/${r.id}`,
    getTags: (r) => [r.supplierTypeName, r.supplierStatus].filter(Boolean),
    getMetadata: (r) => ({ taxId: r.taxId }),
    lookups: [
      {
        field: "supplierTypeName",
        table: "supplierType",
        column: "name",
        from: "supplierTypeId"
      },
      {
        field: "taxId",
        table: "supplierTax",
        column: "taxId",
        from: "id",
        matchOn: "supplierId"
      }
    ]
  },
  item: {
    entityType: "item",
    getTitle: (r) => r.readableId,
    getDescription: (r) => `${r.name} ${r.description || ""}`,
    getLink: (r) => {
      const typeLinks: Record<string, string> = {
        Part: "/x/part/",
        Service: "/x/service/",
        Tool: "/x/tool/",
        Consumable: "/x/consumable/",
        Material: "/x/material/",
        Fixture: "/x/fixture/"
      };
      return (typeLinks[r.type] || "/x/part/") + r.id;
    },
    getTags: (r) => [r.type, r.replenishmentSystem].filter(Boolean),
    getMetadata: (r) => ({ active: r.active })
  },
  job: {
    entityType: "job",
    getTitle: (r) => r.jobId,
    getDescription: (r) => `${r.itemName || ""} ${r.customerName || ""}`,
    getLink: (r) => `/x/job/${r.id}`,
    getTags: (r) => [r.status, r.deadlineType].filter(Boolean),
    getMetadata: (r) => ({ quantity: r.quantity, dueDate: r.dueDate }),
    lookups: [
      { field: "itemName", table: "item", column: "name", from: "itemId" },
      {
        field: "customerName",
        table: "customer",
        column: "name",
        from: "customerId"
      }
    ]
  },
  purchaseOrder: {
    entityType: "purchaseOrder",
    getTitle: (r) => r.purchaseOrderId,
    getDescription: (r) => r.supplierName || "",
    getLink: (r) => `/x/purchase-order/${r.id}`,
    getTags: (r) => [r.status].filter(Boolean),
    getMetadata: (r) => ({
      orderDate: r.orderDate,
      supplierReference: r.supplierReference
    }),
    lookups: [
      {
        field: "supplierName",
        table: "supplier",
        column: "name",
        from: "supplierId"
      }
    ]
  },
  salesInvoice: {
    entityType: "salesInvoice",
    getTitle: (r) => r.invoiceId,
    getDescription: (r) => r.customerName || "",
    getLink: (r) => `/x/sales-invoice/${r.id}`,
    getTags: (r) => [r.status].filter(Boolean),
    getMetadata: (r) => ({ totalAmount: r.totalAmount, dateDue: r.dateDue }),
    lookups: [
      {
        field: "customerName",
        table: "customer",
        column: "name",
        from: "customerId"
      }
    ]
  },
  purchaseInvoice: {
    entityType: "purchaseInvoice",
    getTitle: (r) => r.invoiceId,
    getDescription: (r) => r.supplierName || "",
    getLink: (r) => `/x/purchase-invoice/${r.id}`,
    getTags: (r) => [r.status].filter(Boolean),
    getMetadata: (r) => ({ totalAmount: r.totalAmount, dateDue: r.dateDue }),
    lookups: [
      {
        field: "supplierName",
        table: "supplier",
        column: "name",
        from: "supplierId"
      }
    ]
  },
  nonConformance: {
    entityType: "issue",
    getTitle: (r) => r.nonConformanceId,
    getDescription: (r) => `${r.name} ${r.description || ""}`,
    getLink: (r) => `/x/issue/${r.id}`,
    getTags: (r) => [r.status, r.priority, r.ncTypeName].filter(Boolean),
    getMetadata: (r) => ({ source: r.source, dueDate: r.dueDate }),
    lookups: [
      {
        field: "ncTypeName",
        table: "nonConformanceType",
        column: "name",
        from: "nonConformanceTypeId"
      }
    ]
  },
  gauge: {
    entityType: "gauge",
    getTitle: (r) => r.gaugeId,
    getDescription: (r) => `${r.description || ""} ${r.serialNumber || ""}`,
    getLink: (r) => `/x/quality/gauges/${r.id}`,
    getTags: (r) =>
      [r.gaugeStatus, r.gaugeCalibrationStatus, r.gaugeTypeName].filter(
        Boolean
      ),
    getMetadata: (r) => ({
      nextCalibrationDate: r.nextCalibrationDate,
      serialNumber: r.serialNumber
    }),
    lookups: [
      {
        field: "gaugeTypeName",
        table: "gaugeType",
        column: "name",
        from: "gaugeTypeId"
      }
    ]
  },
  quote: {
    entityType: "quote",
    getTitle: (r) => r.quoteId,
    getDescription: (r) =>
      `${r.customerName || ""} ${r.customerReference || ""}`,
    getLink: (r) => `/x/quote/${r.id}`,
    getTags: (r) => [r.status].filter(Boolean),
    getMetadata: (r) => ({
      customerId: r.customerId,
      expirationDate: r.expirationDate,
      customerReference: r.customerReference
    }),
    lookups: [
      {
        field: "customerName",
        table: "customer",
        column: "name",
        from: "customerId"
      }
    ]
  },
  salesRfq: {
    entityType: "salesRfq",
    getTitle: (r) => r.rfqId,
    getDescription: (r) => r.customerName || "",
    getLink: (r) => `/x/rfq/${r.id}`,
    getTags: (r) => [r.status].filter(Boolean),
    getMetadata: (r) => ({
      customerId: r.customerId,
      expirationDate: r.expirationDate
    }),
    lookups: [
      {
        field: "customerName",
        table: "customer",
        column: "name",
        from: "customerId"
      }
    ]
  },
  salesOrder: {
    entityType: "salesOrder",
    getTitle: (r) => r.salesOrderId,
    getDescription: (r) =>
      `${r.customerName || ""} ${r.customerReference || ""}`,
    getLink: (r) => `/x/sales-order/${r.id}`,
    getTags: (r) => [r.status].filter(Boolean),
    getMetadata: (r) => ({
      customerId: r.customerId,
      orderDate: r.orderDate,
      customerReference: r.customerReference
    }),
    lookups: [
      {
        field: "customerName",
        table: "customer",
        column: "name",
        from: "customerId"
      }
    ]
  },
  supplierQuote: {
    entityType: "supplierQuote",
    getTitle: (r) => r.supplierQuoteId,
    getDescription: (r) => r.supplierName || "",
    getLink: (r) => `/x/supplier-quote/${r.id}`,
    getTags: (r) => [r.status].filter(Boolean),
    getMetadata: (r) => ({
      supplierId: r.supplierId,
      expirationDate: r.expirationDate
    }),
    lookups: [
      {
        field: "supplierName",
        table: "supplier",
        column: "name",
        from: "supplierId"
      }
    ]
  }
};

export type SearchEvent = {
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE";
  recordId: string;
  new: Record<string, any> | null;
};

type IndexKey = { entity_type: string; entity_id: string };

export type IndexRow = IndexKey & {
  title: string;
  description: string;
  link: string;
  tags: string[];
  metadata: Record<string, any>;
};

type PendingUpsert = {
  config: SearchEntityConfig;
  recordId: string;
  record: Record<string, any>;
};

/**
 * Splits one company's events into index writes. Only the last event per
 * record counts: a row inserted and deleted in the same batch must end up
 * absent, whichever order the handler would have applied them in.
 */
export function planIndexWrites(events: SearchEvent[]) {
  const latest = new Map<string, SearchEvent>();
  for (const event of events) {
    latest.set(`${event.table}:${event.recordId}`, event);
  }

  const deletes: IndexKey[] = [];
  const upserts: PendingUpsert[] = [];
  let skipped = events.length - latest.size;

  for (const event of latest.values()) {
    const config = SEARCH_ENTITY_CONFIGS[event.table];
    if (!config) {
      skipped++;
      continue;
    }

    const removed =
      event.operation === "DELETE" ||
      event.operation === "TRUNCATE" ||
      (event.table === "employee" && event.new?.active === false);

    if (removed) {
      deletes.push({
        entity_type: config.entityType,
        entity_id: event.recordId
      });
    } else if (event.new) {
      upserts.push({ config, recordId: event.recordId, record: event.new });
    } else {
      skipped++;
    }
  }

  return { deletes, upserts, skipped };
}

const lookupKey = (lookup: SearchLookup) =>
  `${lookup.table}.${lookup.matchOn ?? "id"}.${lookup.column}`;

/** One read per distinct lookup, covering every record that needs it. */
export function planLookups(upserts: PendingUpsert[]) {
  const plans = new Map<
    string,
    {
      key: string;
      table: string;
      column: string;
      matchOn: string;
      companyScoped: boolean;
      ids: Set<string>;
    }
  >();

  for (const { config, record } of upserts) {
    for (const lookup of config.lookups ?? []) {
      const id = record[lookup.from];
      if (id === null || id === undefined || id === "") continue;

      const key = lookupKey(lookup);
      let plan = plans.get(key);
      if (!plan) {
        plan = {
          key,
          table: lookup.table,
          column: lookup.column,
          matchOn: lookup.matchOn ?? "id",
          companyScoped: !lookup.global,
          ids: new Set()
        };
        plans.set(key, plan);
      }
      plan.ids.add(String(id));
    }
  }

  return [...plans.values()].map((plan) => ({ ...plan, ids: [...plan.ids] }));
}

/** `resolved` maps a lookup key to the looked-up value per matched id. */
export function toIndexRow(
  { config, recordId, record }: PendingUpsert,
  resolved: Map<string, Map<string, unknown>>
): IndexRow {
  const enriched = { ...record };
  for (const lookup of config.lookups ?? []) {
    enriched[lookup.field] = resolved
      .get(lookupKey(lookup))
      ?.get(String(record[lookup.from]));
  }

  return {
    entity_type: config.entityType,
    entity_id: recordId,
    title: config.getTitle(enriched) ?? "",
    description: config.getDescription?.(enriched) || "",
    link: config.getLink(enriched),
    tags: config.getTags(enriched),
    metadata: config.getMetadata(enriched)
  };
}
