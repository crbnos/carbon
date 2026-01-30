/*
License: MIT
Author: Pontus Abrahamssons
Repository: https://github.com/midday-ai/zuno
*/

import { z } from "zod";

// Base schemas
export const BaseEntitySchema = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastSyncedAt: z.string().datetime().optional(),
  remoteWasDeleted: z.boolean().optional()
});

// Address schema (reusable)
export const AddressSchema = z.object({
  type: z.enum(["billing", "shipping", "mailing"]).optional(),
  street: z.string().optional(),
  street2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional()
});

// Phone number schema
export const PhoneNumberSchema = z.object({
  type: z.enum(["home", "work", "mobile", "fax"]).optional(),
  number: z.string(),
  isPrimary: z.boolean().optional()
});

// Enhanced attachment schema with comprehensive file support
export const AttachmentSchema = BaseEntitySchema.extend({
  filename: z.string(),
  originalFilename: z.string().optional(),
  mimeType: z.string(),
  size: z.number(),
  url: z.string().url(),
  downloadUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  entityType: z.enum([
    "invoice",
    "customer",
    "transaction",
    "expense",
    "bill",
    "receipt",
    "journal_entry"
  ]),
  entityId: z.string(),
  attachmentType: z
    .enum(["receipt", "invoice", "contract", "supporting_document", "other"])
    .optional(),
  description: z.string().optional(),
  isPublic: z.boolean().default(false),
  uploadedBy: z.string().optional(),
  checksum: z.string().optional(), // For file integrity
  metadata: z.record(z.any()).optional() // Provider-specific metadata
});

// Account schema for chart of accounts
export const AccountSchema = BaseEntitySchema.extend({
  name: z.string(),
  code: z.string().optional(),
  description: z.string().optional(),
  accountType: z.enum([
    "asset",
    "liability",
    "equity",
    "income",
    "expense",
    "accounts_receivable",
    "accounts_payable",
    "bank",
    "credit_card",
    "current_asset",
    "fixed_asset",
    "other_asset",
    "current_liability",
    "long_term_liability",
    "cost_of_goods_sold",
    "other_income",
    "other_expense"
  ]),
  accountSubType: z.string().optional(),
  parentAccountId: z.string().optional(),
  isActive: z.boolean().default(true),
  currentBalance: z.number().optional(),
  currency: z.string().default("USD"),
  taxCode: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  routingNumber: z.string().optional()
});

// Enhanced customer schema
export const CustomerSchema = BaseEntitySchema.extend({
  name: z.string(),
  displayName: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  phone: PhoneNumberSchema.optional(),
  phoneNumbers: z.array(PhoneNumberSchema).optional(),
  addresses: z.array(AddressSchema).optional(),
  billingAddress: AddressSchema.optional(),
  shippingAddress: AddressSchema.optional(),
  taxNumber: z.string().optional(),
  registrationNumber: z.string().optional(),
  currency: z.string().default("USD"),
  paymentTerms: z.string().optional(),
  creditLimit: z.number().optional(),
  isActive: z.boolean().default(true),
  isArchived: z.boolean().default(false),
  balance: z.number().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.any()).optional(),
  attachments: z.array(AttachmentSchema).optional()
});

// Vendor/Supplier schema
export const VendorSchema = BaseEntitySchema.extend({
  name: z.string(),
  displayName: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  phone: PhoneNumberSchema.optional(),
  phoneNumbers: z.array(PhoneNumberSchema).optional(),
  addresses: z.array(AddressSchema).optional(),
  billingAddress: AddressSchema.optional(),
  taxNumber: z.string().optional(),
  registrationNumber: z.string().optional(),
  currency: z.string().default("USD"),
  paymentTerms: z.string().optional(),
  isActive: z.boolean().default(true),
  isArchived: z.boolean().default(false),
  balance: z.number().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.any()).optional(),
  attachments: z.array(AttachmentSchema).optional()
});

// Item/Product schema
export const ItemSchema = BaseEntitySchema.extend({
  name: z.string(),
  description: z.string().optional(),
  sku: z.string().optional(),
  type: z.enum(["inventory", "non_inventory", "service", "bundle"]),
  unitPrice: z.number().optional(),
  unitOfMeasure: z.string().optional(),
  quantityOnHand: z.number().optional(),
  reorderPoint: z.number().optional(),
  assetAccountId: z.string().optional(),
  incomeAccountId: z.string().optional(),
  expenseAccountId: z.string().optional(),
  isActive: z.boolean().default(true),
  isTaxable: z.boolean().default(true),
  isSold: z.boolean().default(true),
  isPurchased: z.boolean().default(false),
  taxCode: z.string().optional(),
  customFields: z.record(z.any()).optional()
});

// Enhanced invoice schema with attachments
export const InvoiceSchema = BaseEntitySchema.extend({
  number: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  issueDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  status: z.enum(["draft", "sent", "paid", "overdue", "cancelled", "void"]),
  currency: z.string(),
  exchangeRate: z.number().optional(),
  subtotal: z.number(),
  taxAmount: z.number(),
  discountAmount: z.number().optional(),
  total: z.number(),
  amountPaid: z.number().optional(),
  amountDue: z.number().optional(),
  paymentTerms: z.string().optional(),
  reference: z.string().optional(),
  poNumber: z.string().optional(),
  notes: z.string().optional(),
  privateNotes: z.string().optional(),
  billingAddress: AddressSchema.optional(),
  shippingAddress: AddressSchema.optional(),
  lineItems: z.array(
    z.object({
      id: z.string(),
      itemId: z.string().optional(),
      description: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      discount: z.number().optional(),
      total: z.number(),
      taxRate: z.number().optional(),
      taxAmount: z.number().optional(),
      accountId: z.string().optional(),
      trackingCategories: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            value: z.string()
          })
        )
        .optional()
    })
  ),
  attachments: z.array(AttachmentSchema).optional(),
  customFields: z.record(z.any()).optional()
});

// Bill schema (for vendor bills)
export const BillSchema = BaseEntitySchema.extend({
  number: z.string(),
  vendorId: z.string(),
  vendorName: z.string(),
  issueDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  status: z.enum(["draft", "open", "paid", "overdue", "cancelled", "void"]),
  currency: z.string(),
  exchangeRate: z.number().optional(),
  subtotal: z.number(),
  taxAmount: z.number(),
  discountAmount: z.number().optional(),
  total: z.number(),
  amountPaid: z.number().optional(),
  amountDue: z.number().optional(),
  reference: z.string().optional(),
  poNumber: z.string().optional(),
  notes: z.string().optional(),
  privateNotes: z.string().optional(),
  lineItems: z.array(
    z.object({
      id: z.string(),
      itemId: z.string().optional(),
      description: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      discount: z.number().optional(),
      total: z.number(),
      taxRate: z.number().optional(),
      taxAmount: z.number().optional(),
      accountId: z.string().optional(),
      trackingCategories: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            value: z.string()
          })
        )
        .optional()
    })
  ),
  attachments: z.array(AttachmentSchema).optional(),
  customFields: z.record(z.any()).optional()
});

// Enhanced transaction schema with attachments and reconciliation
export const TransactionSchema = BaseEntitySchema.extend({
  type: z.enum([
    "payment",
    "receipt",
    "transfer",
    "adjustment",
    "deposit",
    "withdrawal",
    "charge",
    "refund"
  ]),
  reference: z.string().optional(),
  description: z.string(),
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number().optional(),
  date: z.string().datetime(),
  accountId: z.string(),
  accountName: z.string(),
  toAccountId: z.string().optional(), // For transfers
  toAccountName: z.string().optional(),
  customerId: z.string().optional(),
  vendorId: z.string().optional(),
  contactName: z.string().optional(),
  invoiceId: z.string().optional(),
  billId: z.string().optional(),
  status: z.enum(["pending", "cleared", "reconciled", "voided"]),
  reconciliationStatus: z
    .enum(["unreconciled", "reconciled", "suggested"])
    .optional(),
  reconciliationDate: z.string().datetime().optional(),
  bankTransactionId: z.string().optional(),
  checkNumber: z.string().optional(),
  memo: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  trackingCategories: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        value: z.string()
      })
    )
    .optional(),
  attachments: z.array(AttachmentSchema).optional(),
  customFields: z.record(z.any()).optional()
});

// Expense schema
export const ExpenseSchema = BaseEntitySchema.extend({
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number().optional(),
  date: z.string().datetime(),
  description: z.string(),
  reference: z.string().optional(),
  vendorId: z.string().optional(),
  vendorName: z.string().optional(),
  employeeId: z.string().optional(),
  employeeName: z.string().optional(),
  accountId: z.string(),
  accountName: z.string(),
  category: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  billable: z.boolean().default(false),
  reimbursable: z.boolean().default(false),
  status: z.enum(["draft", "submitted", "approved", "rejected", "paid"]),
  paymentMethod: z
    .enum(["cash", "credit_card", "bank_transfer", "check", "other"])
    .optional(),
  receiptRequired: z.boolean().default(true),
  notes: z.string().optional(),
  taxAmount: z.number().optional(),
  taxRate: z.number().optional(),
  tags: z.array(z.string()).optional(),
  trackingCategories: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        value: z.string()
      })
    )
    .optional(),
  attachments: z.array(AttachmentSchema).optional(),
  customFields: z.record(z.any()).optional()
});

// Journal Entry schema
export const JournalEntrySchema = BaseEntitySchema.extend({
  number: z.string(),
  date: z.string().datetime(),
  description: z.string(),
  reference: z.string().optional(),
  status: z.enum(["draft", "posted", "void"]),
  currency: z.string(),
  exchangeRate: z.number().optional(),
  lineItems: z.array(
    z.object({
      id: z.string(),
      accountId: z.string(),
      accountName: z.string(),
      description: z.string().optional(),
      debitAmount: z.number().optional(),
      creditAmount: z.number().optional(),
      trackingCategories: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            value: z.string()
          })
        )
        .optional()
    })
  ),
  totalDebit: z.number(),
  totalCredit: z.number(),
  notes: z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
  customFields: z.record(z.any()).optional()
});

// Payment schema
export const PaymentSchema = BaseEntitySchema.extend({
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number().optional(),
  date: z.string().datetime(),
  reference: z.string().optional(),
  paymentMethod: z.enum([
    "cash",
    "check",
    "credit_card",
    "bank_transfer",
    "online",
    "other"
  ]),
  accountId: z.string(),
  accountName: z.string(),
  customerId: z.string().optional(),
  vendorId: z.string().optional(),
  contactName: z.string().optional(),
  invoiceId: z.string().optional(),
  billId: z.string().optional(),
  status: z.enum(["pending", "cleared", "bounced", "cancelled"]),
  checkNumber: z.string().optional(),
  memo: z.string().optional(),
  fees: z.number().optional(),
  notes: z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
  customFields: z.record(z.any()).optional()
});

// Company info schema
export const CompanyInfoSchema = BaseEntitySchema.extend({
  name: z.string(),
  legalName: z.string().optional(),
  email: z.string().email().optional(),
  phone: PhoneNumberSchema.optional(),
  website: z.string().url().optional(),
  addresses: z.array(AddressSchema).optional(),
  taxNumber: z.string().optional(),
  registrationNumber: z.string().optional(),
  baseCurrency: z.string().default("USD"),
  fiscalYearStart: z.string().optional(),
  timeZone: z.string().optional(),
  logo: z.string().url().optional(),
  industry: z.string().optional(),
  employees: z.number().optional(),
  customFields: z.record(z.any()).optional()
});

// Enhanced provider-specific metadata
export const ProviderMetadataSchema = z.object({
  provider: z.enum(["xero", "sage", "quickbooks"]),
  externalId: z.string(),
  lastSyncAt: z.string().datetime().optional(),
  syncHash: z.string().optional(),
  version: z.string().optional(),
  rawData: z.record(z.any()).optional(), // Store original provider data
  customFields: z.record(z.any()).optional()
});

// Enhanced API Request/Response schemas
export const ApiRequestSchema = z.object({
  provider: z.enum(["xero", "sage", "quickbooks"]),
  includeAttachments: z.boolean().default(false),
  includeCustomFields: z.boolean().default(false),
  includeRawData: z.boolean().default(false)
});

export const PaginationSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  total: z.number().optional(),
  hasNext: z.boolean().optional(),
  cursor: z.string().optional()
});

// Bulk export request schema
export const BulkExportSchema = z.object({
  provider: z.enum(["xero", "sage", "quickbooks"]),
  entityTypes: z.array(
    z.enum([
      "customers",
      "vendors",
      "invoices",
      "bills",
      "transactions",
      "expenses",
      "accounts",
      "items",
      "journal_entries",
      "payments"
    ])
  ),
  dateRange: z
    .object({
      startDate: z.string().datetime(),
      endDate: z.string().datetime()
    })
    .optional(),
  includeAttachments: z.boolean().default(true),
  includeCustomFields: z.boolean().default(false),
  includeRawData: z.boolean().default(false),
  format: z.enum(["json", "csv", "xlsx"]).default("json"),
  batchSize: z.number().min(1).max(1000).default(100)
});

// Export types
export type Customer = z.infer<typeof CustomerSchema>;
export type Vendor = z.infer<typeof VendorSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type Bill = z.infer<typeof BillSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type Expense = z.infer<typeof ExpenseSchema>;
export type JournalEntry = z.infer<typeof JournalEntrySchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type CompanyInfo = z.infer<typeof CompanyInfoSchema>;
export type ProviderMetadata = z.infer<typeof ProviderMetadataSchema>;

export type ApiRequest = z.infer<typeof ApiRequestSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
export type BulkExport = z.infer<typeof BulkExportSchema>;
export type Address = z.infer<typeof AddressSchema>;
export type PhoneNumber = z.infer<typeof PhoneNumberSchema>;
