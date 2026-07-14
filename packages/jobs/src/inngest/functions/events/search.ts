import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { groupBy } from "@carbon/utils";
import { z } from "zod";
import { inngest } from "../../client";

// Type for the Supabase client with our custom RPC functions
type SearchRpcClient = ReturnType<typeof getCarbonServiceRole> & {
  rpc(
    fn: "delete_from_search_index",
    params: { p_company_id: string; p_entity_type: string; p_entity_id: string }
  ): Promise<any>;
  rpc(
    fn: "upsert_to_search_index",
    params: {
      p_company_id: string;
      p_entity_type: string;
      p_entity_id: string;
      p_title: string;
      p_description: string;
      p_link: string;
      p_tags: string[];
      p_metadata: Record<string, any>;
    }
  ): Promise<any>;
};

// Configuration for each entity type's search indexing
type SearchEntityConfig = {
  entityType: string;
  getTitle: (record: Record<string, any>) => string;
  getDescription?: (record: Record<string, any>) => string;
  getLink: (record: Record<string, any>) => string;
  getTags: (record: Record<string, any>) => string[];
  getMetadata: (record: Record<string, any>) => Record<string, any>;
  enrichRecord?: (
    record: Record<string, any>,
    client: ReturnType<typeof getCarbonServiceRole>
  ) => Promise<Record<string, any>>;
};

// Entity configurations matching the existing sync functions
const SEARCH_ENTITY_CONFIGS: Record<string, SearchEntityConfig> = {
  employee: {
    entityType: "employee",
    getTitle: (r) => r.fullName || "",
    getLink: (r) => `/x/person/${r.id}`,
    getTags: (r) => [r.employeeTypeName].filter(Boolean),
    getMetadata: (r) => ({ active: r.active }),
    enrichRecord: async (record, client) => {
      const { data: user } = await client
        .from("user")
        .select("fullName")
        .eq("id", record.id)
        .single();
      const { data: empType } = await client
        .from("employeeType")
        .select("name")
        .eq("id", record.employeeTypeId)
        .single();
      return {
        ...record,
        fullName: user?.fullName,
        employeeTypeName: empType?.name
      };
    }
  },
  customer: {
    entityType: "customer",
    getTitle: (r) => r.name,
    getLink: (r) => `/x/customer/${r.id}`,
    getTags: (r) => [r.customerTypeName, r.customerStatusName].filter(Boolean),
    getMetadata: (r) => ({ taxId: r.taxId }),
    enrichRecord: async (record, client) => {
      const { data: custType } = await client
        .from("customerType")
        .select("name")
        .eq("id", record.customerTypeId)
        .single();
      const { data: custStatus } = await client
        .from("customerStatus")
        .select("name")
        .eq("id", record.customerStatusId)
        .single();
      const { data: tax } = await (client as any)
        .from("customerTax")
        .select("taxId")
        .eq("customerId", record.id)
        .single();
      return {
        ...record,
        customerTypeName: custType?.name,
        customerStatusName: custStatus?.name,
        taxId: tax?.taxId
      };
    }
  },
  supplier: {
    entityType: "supplier",
    getTitle: (r) => r.name,
    getLink: (r) => `/x/supplier/${r.id}`,
    getTags: (r) => [r.supplierTypeName, r.supplierStatus].filter(Boolean),
    getMetadata: (r) => ({ taxId: r.taxId }),
    enrichRecord: async (record, client) => {
      const { data: suppType } = await client
        .from("supplierType")
        .select("name")
        .eq("id", record.supplierTypeId)
        .single();
      const { data: tax } = await (client as any)
        .from("supplierTax")
        .select("taxId")
        .eq("supplierId", record.id)
        .single();
      return {
        ...record,
        supplierTypeName: suppType?.name,
        taxId: tax?.taxId
      };
    }
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
    enrichRecord: async (record, client) => {
      const { data: item } = await client
        .from("item")
        .select("name")
        .eq("id", record.itemId)
        .single();
      const { data: customer } = await client
        .from("customer")
        .select("name")
        .eq("id", record.customerId)
        .single();
      return {
        ...record,
        itemName: item?.name,
        customerName: customer?.name
      };
    }
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
    enrichRecord: async (record, client) => {
      const { data: supplier } = await client
        .from("supplier")
        .select("name")
        .eq("id", record.supplierId)
        .single();
      return { ...record, supplierName: supplier?.name };
    }
  },
  salesInvoice: {
    entityType: "salesInvoice",
    getTitle: (r) => r.invoiceId,
    getDescription: (r) => r.customerName || "",
    getLink: (r) => `/x/sales-invoice/${r.id}`,
    getTags: (r) => [r.status].filter(Boolean),
    getMetadata: (r) => ({ totalAmount: r.totalAmount, dateDue: r.dateDue }),
    enrichRecord: async (record, client) => {
      const { data: customer } = await client
        .from("customer")
        .select("name")
        .eq("id", record.customerId)
        .single();
      return { ...record, customerName: customer?.name };
    }
  },
  purchaseInvoice: {
    entityType: "purchaseInvoice",
    getTitle: (r) => r.invoiceId,
    getDescription: (r) => r.supplierName || "",
    getLink: (r) => `/x/purchase-invoice/${r.id}`,
    getTags: (r) => [r.status].filter(Boolean),
    getMetadata: (r) => ({ totalAmount: r.totalAmount, dateDue: r.dateDue }),
    enrichRecord: async (record, client) => {
      const { data: supplier } = await client
        .from("supplier")
        .select("name")
        .eq("id", record.supplierId)
        .single();
      return { ...record, supplierName: supplier?.name };
    }
  },
  nonConformance: {
    entityType: "issue",
    getTitle: (r) => r.nonConformanceId,
    getDescription: (r) => `${r.name} ${r.description || ""}`,
    getLink: (r) => `/x/issue/${r.id}`,
    getTags: (r) => [r.status, r.priority, r.ncTypeName].filter(Boolean),
    getMetadata: (r) => ({ source: r.source, dueDate: r.dueDate }),
    enrichRecord: async (record, client) => {
      const { data: ncType } = await client
        .from("nonConformanceType")
        .select("name")
        .eq("id", record.nonConformanceTypeId)
        .single();
      return { ...record, ncTypeName: ncType?.name };
    }
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
    enrichRecord: async (record, client) => {
      const { data: gaugeType } = await client
        .from("gaugeType")
        .select("name")
        .eq("id", record.gaugeTypeId)
        .single();
      return { ...record, gaugeTypeName: gaugeType?.name };
    }
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
    enrichRecord: async (record, client) => {
      const { data: customer } = await client
        .from("customer")
        .select("name")
        .eq("id", record.customerId)
        .single();
      return { ...record, customerName: customer?.name };
    }
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
    enrichRecord: async (record, client) => {
      const { data: customer } = await client
        .from("customer")
        .select("name")
        .eq("id", record.customerId)
        .single();
      return { ...record, customerName: customer?.name };
    }
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
    enrichRecord: async (record, client) => {
      const { data: customer } = await client
        .from("customer")
        .select("name")
        .eq("id", record.customerId)
        .single();
      return { ...record, customerName: customer?.name };
    }
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
    enrichRecord: async (record, client) => {
      const { data: supplier } = await client
        .from("supplier")
        .select("name")
        .eq("id", record.supplierId)
        .single();
      return { ...record, supplierName: supplier?.name };
    }
  }
};

const SearchRecordSchema = z.object({
  event: z.object({
    table: z.string(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]),
    recordId: z.string(),
    new: z.record(z.any()).nullable(),
    old: z.record(z.any()).nullable(),
    timestamp: z.string()
  }),
  companyId: z.string()
});

const SearchPayloadSchema = z.object({
  records: z.array(SearchRecordSchema)
});

export type SearchPayload = z.infer<typeof SearchPayloadSchema>;

export const searchFunction = inngest.createFunction(
  {
    id: "event-handler-search",
    retries: 3
  },
  { event: "carbon/event-search" },
  async ({ event, step, logger }) => {
    const payload = SearchPayloadSchema.parse(event.data);

    logger.info(`Processing ${payload.records.length} search index events`);

    const results = {
      updated: 0,
      deleted: 0,
      skipped: 0,
      failed: 0
    };

    const client = getCarbonServiceRole() as unknown as SearchRpcClient;

    type SearchRecord = (typeof payload.records)[number];
    const byCompany = groupBy(payload.records, (r) => r.companyId);

    for (const [companyId, records] of Object.entries(byCompany) as [
      string,
      SearchRecord[]
    ][]) {
      if (!companyId || companyId === "undefined") {
        results.skipped += records.length;
        continue;
      }

      // Process each company's records as a step
      const companyResult = await step.run(
        `search-index-${companyId}`,
        async () => {
          const stepResults = { updated: 0, deleted: 0, skipped: 0, failed: 0 };

          // Process deletions first
          const deletes = records.filter(
            (r) =>
              r.event.operation === "DELETE" || r.event.operation === "TRUNCATE"
          );

          for (const del of deletes) {
            const config = SEARCH_ENTITY_CONFIGS[del.event.table];
            if (!config) {
              stepResults.skipped++;
              continue;
            }

            try {
              await client.rpc("delete_from_search_index", {
                p_company_id: companyId,
                p_entity_type: config.entityType,
                p_entity_id: del.event.recordId
              });
              stepResults.deleted++;
            } catch (error) {
              logger.error("Failed to delete from search index", {
                error,
                record: del
              });
              stepResults.failed++;
            }
          }

          // Process inserts and updates
          const upserts = records.filter(
            (r) =>
              r.event.operation === "INSERT" || r.event.operation === "UPDATE"
          );

          for (const upsert of upserts) {
            const config = SEARCH_ENTITY_CONFIGS[upsert.event.table];
            if (!config) {
              stepResults.skipped++;
              continue;
            }

            try {
              let record = upsert.event.new as Record<string, any>;

              // Special handling for employee - skip inactive employees
              if (
                upsert.event.table === "employee" &&
                record.active === false
              ) {
                await client.rpc("delete_from_search_index", {
                  p_company_id: companyId,
                  p_entity_type: config.entityType,
                  p_entity_id: upsert.event.recordId
                });
                stepResults.deleted++;
                continue;
              }

              // Enrich record with related data if needed
              if (config.enrichRecord) {
                record = await config.enrichRecord(record, client);
              }

              const title = config.getTitle(record);
              const description = config.getDescription?.(record) || "";
              const link = config.getLink(record);
              const tags = config.getTags(record);
              const metadata = config.getMetadata(record);

              await client.rpc("upsert_to_search_index", {
                p_company_id: companyId,
                p_entity_type: config.entityType,
                p_entity_id: upsert.event.recordId,
                p_title: title,
                p_description: description,
                p_link: link,
                p_tags: tags,
                p_metadata: metadata
              });

              stepResults.updated++;
            } catch (error) {
              logger.error("Failed to update search index", {
                error,
                record: upsert
              });
              stepResults.failed++;
            }
          }

          return stepResults;
        }
      );

      results.updated += companyResult.updated;
      results.deleted += companyResult.deleted;
      results.skipped += companyResult.skipped;
      results.failed += companyResult.failed;
    }

    logger.info("Search function completed", results);

    return results;
  }
);
