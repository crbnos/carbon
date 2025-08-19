import { z } from "zod";

// Address schema
export const AddressSchema = z.object({
  id: z.number().optional(),
  erp_code: z.string().nullable().optional(),
  attention: z.string().optional(),
  address1: z.string().optional(),
  address2: z.string().optional(),
  business_name: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  facility_name: z.string().nullable().optional(),
  phone: z.string().optional().nullable(),
  phone_ext: z.string().optional().nullable(),
  postal_code: z.string().optional(),
  state: z.string().optional(),
});

// Account metrics schema
export const AccountMetricsSchema = z.object({
  order_revenue_all_time: z.number().optional(),
  order_revenue_last_thirty_days: z.number().optional(),
  quotes_sent_all_time: z.number().optional(),
  quotes_sent_last_thirty_days: z.number().optional(),
});

// Account schema
export const AccountSchema = z.object({
  erp_code: z.string().nullable().optional(),
  id: z.number().optional(),
  metrics: AccountMetricsSchema.optional(),
  notes: z.string().nullable().optional(),
  name: z.string().optional(),
  payment_terms: z.string().optional(),
  payment_terms_period: z.number().optional(),
});

// Contact schema
export const ContactSchema = z.object({
  account: AccountSchema.optional(),
  email: z.string().email().optional(),
  first_name: z.string().optional(),
  id: z.number().optional(),
  last_name: z.string().optional(),
  notes: z.string().optional(),
  phone: z.string().optional().nullable(),
  phone_ext: z.string().optional().nullable(),
});

// Company schema for customer
export const CompanySchema = z.object({
  business_name: z.string().optional(),
  erp_code: z.string().nullable().optional(),
  id: z.number().nullable().optional(),
  metrics: AccountMetricsSchema.optional(),
  notes: z.string().nullable().optional(),
  phone: z.string().optional().nullable(),
  phone_ext: z.string().optional().nullable(),
});

// Customer schema
export const CustomerSchema = z.object({
  id: z.number().nullable().optional(),
  company: CompanySchema.optional(),
  email: z.string().email().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  notes: z.string().optional(),
  phone: z.string().optional().nullable(),
  phone_ext: z.string().optional().nullable(),
});

// Sales person schema
export const SalesPersonSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  avatar_color: z.string().optional(),
  email: z.string().email().optional(),
  erp_code: z.string().optional(),
});

// Facility schema
export const FacilitySchema = z.object({
  name: z.string().optional(),
  address: AddressSchema.optional(),
  is_default: z.boolean().optional(),
  phone: z.string().optional().nullable(),
  phone_ext: z.string().optional().nullable(),
  url: z.string().optional(),
});

// Component schema
export const ComponentSchema = z.object({
  id: z.number().optional(),
  child_ids: z.array(z.number()).optional(),
  children: z.array(z.unknown()).optional(), // recursive, so using unknown
  description: z.string().nullable().optional(),
  export_controlled: z.boolean().optional(),
  finishes: z.array(z.unknown()).optional(),
  innate_quantity: z.number().optional(),
  is_assembly: z.boolean().optional(),
  is_root_component: z.boolean().optional(),
  material: z.unknown().nullable().optional(),
  material_operations: z.array(z.unknown()).optional(),
  obtain_method: z.string().optional(),
  parent_ids: z.array(z.number()).optional(),
  part_custom_attrs: z.array(z.unknown()).optional(),
  part_name: z.string().optional().nullable(),
  part_number: z.string().optional().nullable(),
  part_url: z.string().url().optional(),
  part_uuid: z.string().uuid().optional(),
  process: z.unknown().nullable().optional(),
  purchased_component: z.unknown().nullable().optional(),
  revision: z.string().optional().nullable(),
  shop_operations: z.array(z.unknown()).optional(),
  supporting_files: z.array(z.unknown()).optional(),
  thumbnail_url: z.string().url().optional(),
  type: z.string().optional(),
  deliver_quantity: z.number().optional(),
  make_quantity: z.number().optional(),
});

// Order item schema
export const OrderItemSchema = z.object({
  id: z.number().optional(),
  components: z.array(ComponentSchema).optional(),
  description: z.string().nullable().optional(),
  expedite_revenue: z.string().nullable().optional(), // API returns as string or null
  export_controlled: z.boolean().optional(),
  filename: z.string().optional(),
  lead_days: z.number().optional(),
  markup_1_price: z.string().optional(), // API returns as string
  markup_1_name: z.string().nullable().optional(),
  markup_2_price: z.string().optional(), // API returns as string
  markup_2_name: z.string().nullable().optional(),
  private_notes: z.string().nullable().optional(),
  public_notes: z.string().optional(),
  quantity: z.number().optional(),
  quantity_outstanding: z.number().optional(),
  quote_item_id: z.number().optional(),
  quote_item_type: z.enum(["automatic", "manual"]).optional(),
  root_component_id: z.number().optional(),
  ships_on: z.string().optional(), // Date string
  total_price: z.string().optional(), // API returns as string
  unit_price: z.string().optional(), // API returns as string
  base_price: z.string().optional(), // API returns as string
  add_on_fees: z.unknown().nullable().optional(),
  unit_price_before_discounts: z.string().optional(), // API returns as string
  ordered_add_ons: z.array(z.unknown()).optional(),
  pricing_items: z.array(z.unknown()).optional(),
});

// Payment details schema
export const PaymentDetailsSchema = z.object({
  card_brand: z.string().nullable().optional(),
  card_last4: z.string().nullable().optional(),
  net_payout: z.string().optional(), // API returns as string
  payment_type: z.enum(["credit_card", "purchase_order"]).nullable().optional(),
  purchase_order_number: z.string().optional(),
  purchasing_dept_contact_email: z.string().email().nullable().optional(),
  purchasing_dept_contact_name: z.string().optional(),
  shipping_cost: z.string().optional(), // API returns as string
  subtotal: z.string().optional(), // API returns as string
  tax_cost: z.string().optional(), // API returns as string
  tax_rate: z.string().optional(), // API returns as string
  payment_terms: z.string().optional(),
  total_price: z.string().optional(), // API returns as string
});

// Shipping option schema
export const ShippingOptionSchema = z.object({
  customers_account_number: z.string().nullable().optional(),
  customers_carrier: z.string().nullable().optional(),
  shipping_method: z.string().nullable().optional(),
  type: z.string().optional(),
});

// Shipment schema
export const ShipmentSchema = z.array(z.unknown()); // Empty array in the example

// Main Order schema
export const OrderSchema = z.object({
  uuid: z.string().uuid().optional(),
  billing_info: AddressSchema.optional(),
  created: z.string().optional(), // Loosened datetime restriction
  contact: ContactSchema.optional(),
  customer: CustomerSchema.optional(),
  deliver_by: z.string().nullable().optional(),
  estimator: SalesPersonSchema.optional().nullable(),
  send_from_facility: FacilitySchema.optional(),
  erp_code: z.string().nullable().optional(),
  number: z.number().optional(),
  order_items: z.array(OrderItemSchema).optional(),
  payment_details: PaymentDetailsSchema.optional(),
  private_notes: z.string().optional(),
  purchase_order_file_url: z.string().url().nullable().optional(),
  quote_erp_code: z.string().nullable().optional(),
  quote_number: z.number().optional(),
  quote_revision_number: z.number().nullable().optional(),
  sales_person: SalesPersonSchema.optional().nullable(),
  salesperson: SalesPersonSchema.optional().nullable(),
  shipments: ShipmentSchema.optional(),
  shipping_info: AddressSchema.optional(),
  shipping_option: ShippingOptionSchema.optional(),
  ships_on: z.string().optional(), // Date string
  status: z
    .enum([
      "pending",
      "confirmed",
      "on_hold",
      "in_process",
      "completed",
      "cancelled",
    ])
    .optional(),
  quote_rfq_number: z.string().nullable().optional(),
});

// Export the inferred type
export type Order = z.infer<typeof OrderSchema>;
