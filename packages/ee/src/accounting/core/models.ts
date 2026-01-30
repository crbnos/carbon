import z from "zod";
import type {
  AccountingEntity,
  AccountingEntityType,
  EntityDefinition,
  GlobalSyncConfig
} from "./types";

function withNullable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === undefined ? null : v), schema.nullish());
}

export enum ProviderID {
  XERO = "xero"
  // QUICKBOOKS = "quickbooks"
  // SAGE = "sage",
}

/**
 * Schemas for shared provider entities and credentials.
 */

export const ProviderCredentialsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("oauth2"),
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
    scope: z.array(z.string()).optional(),
    tenantId: z.string().optional(),
    tenantName: z.string().optional()
  })
]);

/**
 * Direction of data flow.
 */
export const SyncDirectionSchema = z.enum([
  "two-way",
  "push-to-accounting",
  "pull-from-accounting"
]);

export const AccountingSyncSchema = z.object({
  companyId: z.string(),
  provider: z.nativeEnum(ProviderID),
  syncType: z.enum(["webhook", "scheduled", "trigger"]),
  syncDirection: SyncDirectionSchema,
  entities: z.array(z.custom<AccountingEntity>()),
  metadata: z.record(z.any()).optional()
});

export const ENTITY_DEFINITIONS: Record<
  AccountingEntityType,
  EntityDefinition
> = {
  customer: {
    label: "Customers",
    type: "master",
    supportedDirections: [
      "two-way",
      "push-to-accounting",
      "pull-from-accounting"
    ]
  },
  vendor: {
    label: "Vendors",
    type: "master",
    supportedDirections: [
      "two-way",
      "push-to-accounting",
      "pull-from-accounting"
    ]
  },
  item: {
    label: "Items / Products",
    type: "master",
    supportedDirections: ["two-way", "push-to-accounting"]
  },
  employee: {
    label: "Employees",
    type: "master",
    supportedDirections: ["two-way", "push-to-accounting"]
  },
  purchaseOrder: {
    label: "Purchase Orders",
    type: "transaction",
    dependsOn: ["vendor", "item"],
    supportedDirections: ["push-to-accounting"]
  },
  bill: {
    label: "Bills (Purchase Invoices)",
    type: "transaction",
    dependsOn: ["vendor", "item"],
    supportedDirections: ["two-way", "push-to-accounting"]
  },
  salesOrder: {
    label: "Sales Orders",
    type: "transaction",
    dependsOn: ["customer", "item"],
    supportedDirections: ["push-to-accounting"]
  },
  invoice: {
    label: "Sales Invoices",
    type: "transaction",
    dependsOn: ["customer", "item"],
    supportedDirections: ["two-way", "push-to-accounting"]
  },
  payment: {
    label: "Payments",
    type: "transaction",
    dependsOn: ["invoice", "bill"],
    supportedDirections: ["pull-from-accounting"]
  },
  inventoryAdjustment: {
    label: "Inventory Adjustments",
    type: "transaction",
    dependsOn: ["item"],
    supportedDirections: ["push-to-accounting"]
  }
};

/**
 * Default Safe Configuration
 */
export const DEFAULT_SYNC_CONFIG: GlobalSyncConfig = {
  entities: {
    customer: {
      enabled: true,
      direction: "two-way",
      owner: "accounting"
    },
    vendor: { enabled: true, direction: "two-way", owner: "accounting" },
    item: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    employee: {
      enabled: false, // https://developer.xero.com/documentation/api/accounting/employees
      direction: "two-way",
      owner: "carbon"
    },
    purchaseOrder: {
      enabled: false,
      direction: "two-way",
      owner: "accounting"
    },
    bill: { enabled: true, direction: "two-way", owner: "accounting" },
    salesOrder: {
      enabled: false,
      direction: "push-to-accounting",
      owner: "carbon"
    },
    invoice: { enabled: true, direction: "two-way", owner: "accounting" },
    payment: {
      enabled: false,
      direction: "pull-from-accounting",
      owner: "accounting"
    },
    inventoryAdjustment: {
      enabled: false,
      direction: "push-to-accounting",
      owner: "carbon"
    }
  }
};

// ============================================================================
// 4. VALIDATION LOGIC
// ============================================================================

export function validateSyncConfig(config: GlobalSyncConfig): string[] {
  const errors: string[] = [];

  // 1. Validate Dependencies (Always Enforced)
  (Object.keys(config.entities) as AccountingEntityType[]).forEach((entity) => {
    const entityConfig = config.entities[entity];
    const definition = ENTITY_DEFINITIONS[entity];

    if (entityConfig.enabled && definition.dependsOn) {
      definition.dependsOn.forEach((dependency) => {
        if (!config.entities[dependency].enabled) {
          errors.push(
            `Cannot enable '${definition.label}': Missing dependency '${ENTITY_DEFINITIONS[dependency].label}'.`
          );
        }
      });
    }
  });

  // 2. Validate Directions
  (Object.keys(config.entities) as AccountingEntityType[]).forEach((entity) => {
    const entityConfig = config.entities[entity];
    const definition = ENTITY_DEFINITIONS[entity];

    if (
      entityConfig.enabled &&
      !definition.supportedDirections.includes(entityConfig.direction)
    ) {
      errors.push(
        `Entity '${definition.label}' does not support direction '${
          entityConfig.direction
        }'. Supported: ${definition.supportedDirections.join(", ")}`
      );
    }
  });

  return errors;
}

const createEntityConfigSchema = () =>
  z.object({
    enabled: z.boolean(),
    direction: SyncDirectionSchema,
    owner: z.enum(["carbon", "accounting"]),
    syncFromDate: z.string().datetime().optional()
  });

export const SyncConfigSchema = z.object({
  entities: z.object({
    customer: createEntityConfigSchema(),
    vendor: createEntityConfigSchema(),
    item: createEntityConfigSchema(),
    employee: createEntityConfigSchema(),
    purchaseOrder: createEntityConfigSchema(),
    bill: createEntityConfigSchema(),
    salesOrder: createEntityConfigSchema(),
    invoice: createEntityConfigSchema(),
    payment: createEntityConfigSchema(),
    inventoryAdjustment: createEntityConfigSchema()
  })
});

export const ProviderIntegrationMetadataSchema = z.object({
  syncConfig: SyncConfigSchema,
  credentials: ProviderCredentialsSchema.optional()
});

// /********************************************************\
// *               Accounting Entity Schemas                *
// \********************************************************/

export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  companyId: z.string(),
  email: z.string().optional(),
  website: withNullable(z.string().url()),
  taxId: withNullable(z.string()),
  currencyCode: z.string().default("USD"),
  balance: z.number().nullish(),
  creditLimit: z.number().nullish(),
  paymentTerms: z.string().nullish(),
  updatedAt: z.string().datetime(),
  workPhone: withNullable(z.string()),
  mobilePhone: withNullable(z.string()),
  fax: withNullable(z.string()),
  homePhone: withNullable(z.string()),
  isVendor: z.boolean(),
  isCustomer: z.boolean(),
  addresses: z.array(
    z.object({
      label: z.string().nullish(),
      type: z.string().nullish(),
      line1: z.string().nullish(),
      line2: z.string().nullish(),
      city: z.string().nullish(),
      country: z.string().nullish(),
      region: z.string().nullish(),
      postalCode: z.string().nullish()
    })
  ),
  raw: z.record(z.any())
});

export const EmployeeSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: withNullable(z.string()),
  email: withNullable(z.string().email()),
  active: z.boolean().default(true),
  // Job-related fields from employeeJob
  title: withNullable(z.string()),
  departmentId: withNullable(z.string()),
  locationId: withNullable(z.string()),
  managerId: withNullable(z.string()),
  startDate: withNullable(z.string()),
  // External link (used by Xero)
  externalLink: z
    .object({
      url: withNullable(z.string().url()),
      description: withNullable(z.string())
    })
    .optional(),
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});

// ============================================================================
// SALES ORDER (push-only to accounting as Xero Quotes)
// ============================================================================

export const SalesOrderLineSchema = z.object({
  id: z.string(),
  salesOrderLineType: z.string(),
  itemId: withNullable(z.string()),
  itemCode: withNullable(z.string()), // item.readableIdWithRevision
  description: withNullable(z.string()),
  quantity: z.number(),
  unitPrice: z.number(),
  setupPrice: z.number(),
  accountNumber: withNullable(z.string()),
  lineAmount: z.number()
});

export const SalesOrderSchema = z.object({
  id: z.string(),
  salesOrderId: z.string(), // Human-readable SO number
  companyId: z.string(),
  customerId: z.string(),
  customerExternalId: withNullable(z.string()), // Xero ContactID for the customer
  status: z.enum([
    "Draft",
    "Needs Approval",
    "Confirmed",
    "In Progress",
    "To Ship and Invoice",
    "To Ship",
    "To Invoice",
    "Completed",
    "Invoiced",
    "Cancelled",
    "Closed"
  ]),
  orderDate: withNullable(z.string()),
  currencyCode: z.string(),
  exchangeRate: z.number(),
  customerReference: withNullable(z.string()),
  lines: z.array(SalesOrderLineSchema),
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});

// Sales Invoice schemas
export const SalesInvoiceLineSchema = z.object({
  id: z.string(),
  invoiceLineType: z.string(),
  itemId: withNullable(z.string()),
  itemCode: withNullable(z.string()), // readableIdWithRevision
  description: withNullable(z.string()),
  quantity: z.number(),
  unitPrice: z.number(),
  taxPercent: z.number(),
  lineAmount: z.number()
});

export const SalesInvoiceSchema = z.object({
  id: z.string(),
  invoiceId: z.string(), // readable ID like "INV-0001"
  companyId: z.string(),
  customerId: z.string(),
  customerExternalId: withNullable(z.string()), // Xero ContactID for the customer
  status: z.enum([
    "Draft",
    "Pending",
    "Submitted",
    "Partially Paid",
    "Paid",
    "Overdue",
    "Voided",
    "Credit Note Issued",
    "Return"
  ]),
  currencyCode: z.string(),
  exchangeRate: z.number(),
  dateIssued: withNullable(z.string()),
  dateDue: withNullable(z.string()),
  datePaid: withNullable(z.string()),
  customerReference: withNullable(z.string()),
  subtotal: z.number(),
  totalTax: z.number(),
  totalDiscount: z.number(),
  totalAmount: z.number(),
  balance: z.number(),
  lines: z.array(SalesInvoiceLineSchema),
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});

// Bill (Purchase Invoice) schemas
export const BillLineSchema = z.object({
  id: z.string(),
  description: withNullable(z.string()),
  quantity: z.number(),
  unitPrice: z.number(),
  itemId: withNullable(z.string()),
  itemCode: withNullable(z.string()),
  accountNumber: withNullable(z.string()),
  taxPercent: withNullable(z.number()),
  taxAmount: withNullable(z.number()),
  totalAmount: z.number(),
  purchaseOrderLineId: withNullable(z.string())
});

export const BillSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  invoiceId: z.string(), // Human-readable invoice number
  supplierId: withNullable(z.string()),
  supplierExternalId: withNullable(z.string()), // Xero ContactID for the supplier
  status: z.enum([
    "Draft",
    "Pending",
    "Submitted",
    "Return",
    "Debit Note Issued",
    "Paid",
    "Partially Paid",
    "Overdue",
    "Voided"
  ]),
  dateIssued: withNullable(z.string()),
  dateDue: withNullable(z.string()),
  datePaid: withNullable(z.string()),
  currencyCode: z.string(),
  exchangeRate: z.number(),
  subtotal: z.number(),
  totalTax: z.number(),
  totalDiscount: z.number(),
  totalAmount: z.number(),
  balance: z.number(),
  supplierReference: withNullable(z.string()),
  lines: z.array(BillLineSchema),
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});

// Purchase Order schemas
export const PurchaseOrderLineSchema = z.object({
  id: z.string(),
  description: withNullable(z.string()),
  quantity: z.number(),
  unitPrice: z.number(),
  itemId: withNullable(z.string()),
  itemCode: withNullable(z.string()),
  accountNumber: withNullable(z.string()),
  taxPercent: withNullable(z.number()),
  taxAmount: withNullable(z.number()),
  totalAmount: z.number(),
  quantityReceived: withNullable(z.number()),
  quantityInvoiced: withNullable(z.number())
});

export const PurchaseOrderSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  purchaseOrderId: z.string(), // Human-readable PO number
  supplierId: z.string(),
  supplierExternalId: withNullable(z.string()), // Xero ContactID for the supplier
  status: z.enum([
    "Draft",
    "To Review",
    "Rejected",
    "To Receive",
    "To Receive and Invoice",
    "To Invoice",
    "Completed",
    "Closed",
    "Planned"
  ]),
  orderDate: withNullable(z.string()),
  deliveryDate: withNullable(z.string()),
  deliveryAddress: withNullable(z.string()),
  deliveryInstructions: withNullable(z.string()),
  currencyCode: withNullable(z.string()),
  exchangeRate: withNullable(z.number()),
  subtotal: z.number(),
  totalTax: z.number(),
  totalAmount: z.number(),
  supplierReference: withNullable(z.string()),
  lines: z.array(PurchaseOrderLineSchema),
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});

// ============================================================================
// INVENTORY ADJUSTMENT (itemLedger-based, push-only to accounting)
// ============================================================================

export const InventoryAdjustmentSchema = z.object({
  id: z.string(),
  entryNumber: z.number(),
  postingDate: z.string(),
  entryType: z.enum(["Positive Adjmt.", "Negative Adjmt."]),
  itemId: z.string(),
  locationId: withNullable(z.string()),
  quantity: z.number(), // positive for positive adj, negative for negative adj
  companyId: z.string(),
  unitCost: z.number(), // from itemCost table
  inventoryAccount: z.string(), // GL account code from postingGroupInventory
  adjustmentVarianceAccount: z.string(), // GL account code from postingGroupInventory
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});
