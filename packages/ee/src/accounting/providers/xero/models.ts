import { z } from "zod";
import type { Accounting } from "../../core/types";

export namespace Xero {
  // Shared address schema for contacts and employees
  export const AddressSchema = z.object({
    AddressType: z.enum(["POBOX", "STREET", "DELIVERY"]),
    AddressLine1: z.string().optional(),
    AddressLine2: z.string().optional(),
    AddressLine3: z.string().optional(),
    AddressLine4: z.string().optional(),
    City: z.string().optional(),
    Region: z.string().optional(),
    PostalCode: z.string().optional(),
    Country: z.string().optional(),
    AttentionTo: z.string().optional()
  });

  export const PhoneSchema = z.object({
    PhoneType: z.enum(["DDI", "DEFAULT", "FAX", "MOBILE"]),
    PhoneNumber: z.string().optional(),
    PhoneAreaCode: z.string().optional(),
    PhoneCountryCode: z.string().optional()
  });

  export const BalancesSchema = z.object({
    AccountsReceivable: z.object({
      Outstanding: z.number(),
      Overdue: z.number()
    }),
    AccountsPayable: z.object({
      Outstanding: z.number(),
      Overdue: z.number()
    })
  });

  export const BrandingThemeSchema = z.object({
    BrandingThemeID: z.string().uuid(),
    Name: z.string()
  });

  export const BatchPaymentsSchema = z.object({
    BankAccountNumber: z.string(),
    BankAccountName: z.string(),
    Details: z.string(),
    Code: z.string().optional(),
    Reference: z.string().optional()
  });

  export const ContactSchema = z.object({
    ContactID: z.string().uuid(),
    ContactStatus: z.literal("ACTIVE"),

    Name: z.string(),
    Website: z.string().optional(),

    FirstName: z.string().optional(),
    LastName: z.string().optional(),

    EmailAddress: z.string().email().optional(),
    ContactNumber: z.string().optional(),

    BankAccountDetails: z.string().optional(),
    TaxNumber: z.string().optional(),

    AccountsReceivableTaxType: z.string().optional(),
    AccountsPayableTaxType: z.string().optional(),

    Addresses: z.array(AddressSchema),
    Phones: z.array(PhoneSchema),

    UpdatedDateUTC: z.string(), // serialized /Date(...)/

    ContactGroups: z.array(z.unknown()),

    IsSupplier: z.boolean(),
    IsCustomer: z.boolean(),

    DefaultCurrency: z.string().optional(),

    BrandingTheme: BrandingThemeSchema.optional(),
    BatchPayments: BatchPaymentsSchema.optional(),

    Balances: BalancesSchema.optional(),

    ContactPersons: z.array(z.unknown()),

    HasAttachments: z.boolean(),
    HasValidationErrors: z.boolean()
  });

  export type Contact = z.infer<typeof ContactSchema>;

  // Employee schema for Xero Accounting API Employees endpoint
  // Note: This is from the deprecated Accounting API endpoint, not PayrollAU/UK/NZ
  export const EmployeeSchema = z.object({
    EmployeeID: z.string().uuid(),
    Status: z.enum(["ACTIVE", "DELETED"]).optional(),
    FirstName: z.string(),
    LastName: z.string(),
    ExternalLink: z
      .object({
        Url: z.string().url().optional(),
        Description: z.string().optional()
      })
      .optional(),
    UpdatedDateUTC: z.string() // serialized /Date(...)/
  });

  export type Employee = z.infer<typeof EmployeeSchema>;

  // Item schemas for Xero Accounting API Items endpoint
  export const PurchaseDetailsSchema = z.object({
    UnitPrice: z.number().optional(),
    AccountCode: z.string().optional(),
    COGSAccountCode: z.string().optional(),
    TaxType: z.string().optional()
  });

  export const SalesDetailsSchema = z.object({
    UnitPrice: z.number().optional(),
    AccountCode: z.string().optional(),
    TaxType: z.string().optional()
  });

  export const ItemSchema = z.object({
    ItemID: z.string().uuid(),
    Code: z.string().max(30),
    Name: z.string().max(50).optional(),
    Description: z.string().max(4000).optional(),
    PurchaseDescription: z.string().optional(),
    PurchaseDetails: PurchaseDetailsSchema.optional(),
    SalesDetails: SalesDetailsSchema.optional(),
    IsTrackedAsInventory: z.boolean().optional(),
    IsSold: z.boolean().optional(),
    IsPurchased: z.boolean().optional(),
    QuantityOnHand: z.number().optional(),
    TotalCostPool: z.number().optional(),
    UpdatedDateUTC: z.string()
  });

  export type PurchaseDetails = z.infer<typeof PurchaseDetailsSchema>;
  export type SalesDetails = z.infer<typeof SalesDetailsSchema>;
  export type Item = z.infer<typeof ItemSchema>;

  // Invoice/Bill schemas for Xero Accounting API
  // Type: ACCPAY = Accounts Payable (Bill/Purchase Invoice)
  // Type: ACCREC = Accounts Receivable (Sales Invoice)
  export const InvoiceLineItemSchema = z.object({
    LineItemID: z.string().uuid().optional(),
    Description: z.string().optional(),
    Quantity: z.number().optional(),
    UnitAmount: z.number().optional(),
    ItemCode: z.string().optional(),
    AccountCode: z.string().optional(),
    TaxType: z.string().optional(),
    TaxAmount: z.number().optional(),
    LineAmount: z.number().optional(),
    DiscountRate: z.number().optional(),
    Tracking: z.array(z.unknown()).optional()
  });

  export const InvoiceContactSchema = z.object({
    ContactID: z.string().uuid(),
    Name: z.string().optional()
  });

  export const InvoiceSchema = z.object({
    InvoiceID: z.string().uuid(),
    Type: z.enum(["ACCPAY", "ACCREC"]), // ACCPAY = Bill, ACCREC = Sales Invoice
    InvoiceNumber: z.string().optional(),
    Reference: z.string().optional(),
    Contact: InvoiceContactSchema,
    Date: z.string().optional(), // YYYY-MM-DD
    DueDate: z.string().optional(),
    Status: z.enum([
      "DRAFT",
      "SUBMITTED",
      "AUTHORISED",
      "PAID",
      "VOIDED",
      "DELETED"
    ]),
    LineAmountTypes: z.enum(["Exclusive", "Inclusive", "NoTax"]).optional(),
    LineItems: z.array(InvoiceLineItemSchema),
    SubTotal: z.number().optional(),
    TotalTax: z.number().optional(),
    Total: z.number().optional(),
    AmountDue: z.number().optional(),
    AmountPaid: z.number().optional(),
    CurrencyCode: z.string().optional(),
    CurrencyRate: z.number().optional(),
    UpdatedDateUTC: z.string()
  });

  export type Invoice = z.infer<typeof InvoiceSchema>;
  export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;
  export type InvoiceContact = z.infer<typeof InvoiceContactSchema>;

  // Purchase Order schemas for Xero Accounting API
  export const PurchaseOrderLineItemSchema = z.object({
    LineItemID: z.string().uuid().optional(),
    Description: z.string().optional(),
    Quantity: z.number().optional(),
    UnitAmount: z.number().optional(),
    ItemCode: z.string().optional(),
    AccountCode: z.string().optional(),
    TaxType: z.string().optional(),
    TaxAmount: z.number().optional(),
    LineAmount: z.number().optional(),
    DiscountRate: z.number().optional(),
    Tracking: z.array(z.unknown()).optional()
  });

  export const PurchaseOrderContactSchema = z.object({
    ContactID: z.string().uuid(),
    Name: z.string().optional()
  });

  export const PurchaseOrderSchema = z.object({
    PurchaseOrderID: z.string().uuid(),
    PurchaseOrderNumber: z.string().optional(),
    Reference: z.string().optional(),
    Contact: PurchaseOrderContactSchema,
    Date: z.string().optional(), // YYYY-MM-DD
    DeliveryDate: z.string().optional(),
    DeliveryAddress: z.string().optional(),
    AttentionTo: z.string().optional(),
    Telephone: z.string().optional(),
    DeliveryInstructions: z.string().optional(),
    Status: z.enum(["DRAFT", "SUBMITTED", "AUTHORISED", "BILLED", "DELETED"]),
    LineAmountTypes: z.enum(["Exclusive", "Inclusive", "NoTax"]).optional(),
    LineItems: z.array(PurchaseOrderLineItemSchema),
    SubTotal: z.number().optional(),
    TotalTax: z.number().optional(),
    Total: z.number().optional(),
    CurrencyCode: z.string().optional(),
    CurrencyRate: z.number().optional(),
    UpdatedDateUTC: z.string()
  });

  export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;
  export type PurchaseOrderLineItem = z.infer<
    typeof PurchaseOrderLineItemSchema
  >;
  export type PurchaseOrderContact = z.infer<typeof PurchaseOrderContactSchema>;

  // Manual Journal schemas for Xero Accounting API ManualJournals endpoint
  export const ManualJournalLineSchema = z.object({
    LineAmount: z.number(),
    AccountCode: z.string(),
    Description: z.string().optional(),
    TaxType: z.string().optional(),
    TaxAmount: z.number().optional(),
    IsBlank: z.boolean().optional()
  });

  export const ManualJournalSchema = z.object({
    ManualJournalID: z.string().uuid(),
    Narration: z.string(),
    Date: z.string().optional(),
    Status: z.enum(["DRAFT", "POSTED", "DELETED", "VOIDED", "ARCHIVED"]),
    LineAmountTypes: z.string().optional(),
    Url: z.string().optional(),
    ShowOnCashBasisReports: z.boolean().optional(),
    JournalLines: z.array(ManualJournalLineSchema).optional(),
    UpdatedDateUTC: z.string()
  });

  export type ManualJournalLine = z.infer<typeof ManualJournalLineSchema>;
  export type ManualJournal = z.infer<typeof ManualJournalSchema>;

  // Quote schemas for Xero Accounting API Quotes endpoint
  // Xero Quotes are the closest equivalent to Sales Orders
  export const QuoteLineItemSchema = z.object({
    LineItemID: z.string().uuid().optional(),
    Description: z.string().optional(),
    Quantity: z.number().optional(),
    UnitAmount: z.number().optional(),
    ItemCode: z.string().max(30).optional(),
    AccountCode: z.string().optional(),
    TaxType: z.string().optional(),
    TaxAmount: z.number().optional(),
    LineAmount: z.number().optional(),
    DiscountRate: z.number().optional(),
    DiscountAmount: z.number().optional()
  });

  export const QuoteContactSchema = z.object({
    ContactID: z.string().uuid()
  });

  export const QuoteSchema = z.object({
    QuoteID: z.string().uuid(),
    QuoteNumber: z.string().max(255).optional(),
    Reference: z.string().max(4000).optional(),
    Terms: z.string().max(4000).optional(),
    Contact: QuoteContactSchema,
    LineItems: z.array(QuoteLineItemSchema).optional(),
    Date: z.string().optional(),
    ExpiryDate: z.string().optional(),
    Status: z.enum([
      "DRAFT",
      "SENT",
      "DECLINED",
      "ACCEPTED",
      "INVOICED",
      "DELETED"
    ]),
    CurrencyCode: z.string().optional(),
    CurrencyRate: z.number().optional(),
    SubTotal: z.number().optional(),
    TotalTax: z.number().optional(),
    Total: z.number().optional(),
    TotalDiscount: z.number().optional(),
    Title: z.string().max(100).optional(),
    Summary: z.string().max(3000).optional(),
    LineAmountTypes: z.string().optional(),
    UpdatedDateUTC: z.string()
  });

  export type QuoteLineItem = z.infer<typeof QuoteLineItemSchema>;
  export type QuoteContact = z.infer<typeof QuoteContactSchema>;
  export type Quote = z.infer<typeof QuoteSchema>;
}

export const parseDotnetDate = (date: Date | string) => {
  if (typeof date === "string") {
    const value = date.replace(/\/Date\((\d+)([-+]\d+)?\)\//, "$1");
    return new Date(parseInt(value));
  }

  return date;
};

export const transformXeroPhones = (
  contact: Xero.Contact
): Pick<
  Accounting.Contact,
  "homePhone" | "workPhone" | "mobilePhone" | "fax"
> => {
  const phones = contact.Phones ?? [];

  const homePhone = phones.find((p) => p.PhoneType === "DDI" && p.PhoneNumber);

  const workPhone = phones.find(
    (p) => p.PhoneType === "DEFAULT" && p.PhoneNumber
  );
  const mobilePhone = phones.find(
    (p) => p.PhoneType === "MOBILE" && p.PhoneNumber
  );
  const fax = phones.find((p) => p.PhoneType === "FAX" && p.PhoneNumber);

  return {
    workPhone: workPhone?.PhoneNumber,
    mobilePhone: mobilePhone?.PhoneNumber,
    homePhone: homePhone?.PhoneNumber,
    fax: fax?.PhoneNumber
  };
};

export const transformXeroContact = (
  contact: Xero.Contact,
  companyId: string
): Accounting.Contact => {
  const firstName = contact.FirstName || "";
  const lastName = contact.LastName || "";

  const addresses = contact.Addresses ?? [];

  const { workPhone, mobilePhone, homePhone } = transformXeroPhones(contact);

  return {
    id: contact.ContactID,
    name: contact.Name,
    firstName,
    lastName,
    companyId,
    website: contact.Website,
    currencyCode: contact.DefaultCurrency ?? "USD",
    taxId: contact.TaxNumber,
    email: contact.EmailAddress,
    isCustomer: contact.IsCustomer,
    isVendor: contact.IsSupplier,
    addresses: addresses.map((a) => ({
      label: a.AttentionTo,
      line1: a.AddressLine1,
      line2: a.AddressLine2,
      city: a.City,
      region: a.Region,
      country: a.Country,
      postalCode: a.PostalCode
    })),
    workPhone,
    mobilePhone,
    homePhone,
    updatedAt: parseDotnetDate(contact.UpdatedDateUTC).toISOString(),
    raw: contact
  };
};
