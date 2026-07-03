import { z } from "zod";

/** Wrapper: every extracted field carries a confidence score */
function confidenceField<T extends z.ZodTypeAny>(schema: T) {
  return z.object({
    value: schema.nullable(),
    confidence: z.number().min(0).max(1)
  });
}

/** Invoice line item extracted from PDF */
const invoiceLineSchema = z.object({
  partNumber: confidenceField(z.string()),
  description: confidenceField(z.string()),
  quantity: confidenceField(z.number()),
  unitPrice: confidenceField(z.number()),
  totalPrice: confidenceField(z.number())
});

/** Top-level invoice extraction schema sent to AI */
export const invoiceExtractionSchema = z.object({
  // Resolved against the candidate option lists passed to the AI (id of a real
  // record, or null when none of the listed options match).
  supplierId: confidenceField(z.string()),
  paymentTermId: confidenceField(z.string()),
  supplierName: confidenceField(z.string()),
  supplierContactName: confidenceField(z.string()),
  supplierContactEmail: confidenceField(z.string()),
  supplierContactPhone: confidenceField(z.string()),
  supplierAddressLine1: confidenceField(z.string()),
  supplierAddressLine2: confidenceField(z.string()),
  supplierCity: confidenceField(z.string()),
  supplierStateProvince: confidenceField(z.string()),
  supplierPostalCode: confidenceField(z.string()),
  supplierCountry: confidenceField(
    z
      .string()
      .describe(
        'ISO 3166-1 alpha-2 country code (e.g. "US", "ID", "GB", "SG"), not the full country name'
      )
  ),
  invoiceNumber: confidenceField(z.string()),
  invoiceDate: confidenceField(z.string()),
  dueDate: confidenceField(z.string()),
  paymentTerms: confidenceField(z.string()),
  purchaseOrderNumber: confidenceField(z.string()),
  currencyCode: confidenceField(z.string()),
  subtotal: confidenceField(z.number()),
  taxAmount: confidenceField(z.number()),
  shippingCost: confidenceField(z.number()),
  totalAmount: confidenceField(z.number()),
  lineItems: z.array(invoiceLineSchema)
});

/** RFQ line item extracted from PDF */
const rfqLineSchema = z.object({
  partNumber: confidenceField(z.string()),
  description: confidenceField(z.string()),
  quantity: confidenceField(z.number())
});

export const rfqExtractionSchema = z.object({
  // Resolved against the candidate customer list passed to the AI (id of a real
  // record, or null when none of the listed options match).
  customerId: confidenceField(z.string()),
  customerName: confidenceField(z.string()),
  purchasingContactName: confidenceField(z.string()),
  purchasingContactEmail: confidenceField(z.string()),
  purchasingContactPhone: confidenceField(z.string()),
  engineeringContactName: confidenceField(z.string()),
  engineeringContactEmail: confidenceField(z.string()),
  engineeringContactPhone: confidenceField(z.string()),
  customerAddressLine1: confidenceField(z.string()),
  customerAddressLine2: confidenceField(z.string()),
  customerCity: confidenceField(z.string()),
  customerStateProvince: confidenceField(z.string()),
  customerPostalCode: confidenceField(z.string()),
  customerCountry: confidenceField(z.string()),
  rfqNumber: confidenceField(z.string()),
  rfqDate: confidenceField(z.string()),
  dueDate: confidenceField(z.string()),
  requestedDeliveryDate: confidenceField(z.string()),
  lineItems: z.array(rfqLineSchema)
});

export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;
export type RfqExtraction = z.infer<typeof rfqExtractionSchema>;
