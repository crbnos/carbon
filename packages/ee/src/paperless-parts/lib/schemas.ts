// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { z } from "zod";

// Address schema
export const AddressSchema = z.object({
  id: z.number().optional().nullable(),
  erp_code: z.string().optional().nullable(),
  attention: z.string().optional().nullable(),
  address1: z.string().optional().nullable(),
  address2: z.string().optional().nullable(),
  business_name: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  facility_name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  phone_ext: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  state: z.string().optional().nullable()
});

// Account metrics schema
export const AccountMetricsSchema = z.object({
  order_revenue_all_time: z.number().optional().nullable(),
  order_revenue_last_thirty_days: z.number().optional().nullable(),
  quotes_sent_all_time: z.number().optional().nullable(),
  quotes_sent_last_thirty_days: z.number().optional().nullable()
});

// Account schema
export const AccountSchema = z.object({
  erp_code: z.string().optional().nullable(),
  id: z.number().optional().nullable(),
  metrics: AccountMetricsSchema.optional().nullable(),
  notes: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  payment_terms: z.string().optional().nullable(),
  payment_terms_period: z.number().optional().nullable()
});

// Contact schema
export const ContactSchema = z.object({
  account: AccountSchema.optional().nullable(),
  email: z.string().email().optional().nullable(),
  first_name: z.string().optional().nullable(),
  id: z.number().optional().nullable(),
  last_name: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  phone_ext: z.string().optional().nullable()
});

// Company schema for customer
export const CompanySchema = z.object({
  business_name: z.string().optional().nullable(),
  erp_code: z.string().optional().nullable(),
  id: z.number().optional().nullable(),
  metrics: AccountMetricsSchema.optional().nullable(),
  notes: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  phone_ext: z.string().optional().nullable()
});

// Customer schema
export const CustomerSchema = z.object({
  id: z.number().optional().nullable(),
  company: CompanySchema.optional().nullable(),
  email: z.string().email().optional().nullable(),
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  phone_ext: z.string().optional().nullable()
});

// Sales person schema
export const SalesPersonSchema = z.object({
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  avatar_color: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  erp_code: z.string().optional().nullable()
});

// Facility schema
export const FacilitySchema = z.object({
  name: z.string().optional().nullable(),
  address: AddressSchema.optional().nullable(),
  is_default: z.boolean().optional().nullable(),
  phone: z.string().optional().nullable(),
  phone_ext: z.string().optional().nullable(),
  url: z.string().optional().nullable()
});

// Costing variable schema
export const CostingVariableSchema = z.object({
  label: z.string().optional().nullable(),
  variable_class: z.string().optional().nullable(),
  value_type: z
    .enum(["number", "currency", "boolean", "string", "table", "date"])
    .nullable()
    .optional()
    .nullable(),
  value: z.any().optional().nullable(),
  row: z.record(z.string(), z.unknown()).optional().nullable(),
  options: z.unknown().optional().nullable(),
  type: z
    .enum(["number", "currency", "boolean", "string", "table", "date"])
    .nullable()
    .optional()
    .nullable()
});

// Shop operation quantity schema
export const ShopOperationQuantitySchema = z.object({
  price: z.string().optional().nullable(), // API returns as string
  manual_price: z.string().optional().nullable(),
  lead_time: z.number().optional().nullable(),
  manual_lead_time: z.number().optional().nullable(),
  quantity: z.number().optional().nullable()
});

// Shop operation schema
export const ShopOperationSchema = z.object({
  id: z.number().optional().nullable(),
  category: z.string().optional().nullable(),
  cost: z.string().optional().nullable(), // API returns as string
  costing_variables: z.array(CostingVariableSchema).optional().nullable(),
  is_finish: z.boolean().optional().nullable(),
  is_outside_service: z.boolean().optional().nullable(),
  name: z.string().optional().nullable(),
  operation_definition_name: z.string().optional().nullable(),
  operation_definition_erp_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  quantities: z.array(ShopOperationQuantitySchema).optional().nullable(),
  position: z.number().optional().nullable(),
  runtime: z.number().optional().nullable(),
  setup_time: z.number().optional().nullable()
});

// Component schema
export const ComponentSchema = z.object({
  id: z.number().optional().nullable(),
  child_ids: z.array(z.number()).optional().nullable(),
  children: z.array(z.unknown()).optional().nullable(), // TODO: array of child_id and quantity objects
  description: z.string().optional().nullable(),
  export_controlled: z.boolean().optional().nullable(),
  finishes: z.array(z.unknown()).optional().nullable(),
  innate_quantity: z.number().optional().nullable(),
  is_assembly: z.boolean().optional().nullable(),
  is_root_component: z.boolean().optional().nullable(),
  material: z.unknown().optional().nullable(),
  material_operations: z.array(z.unknown()).optional().nullable(), // TODO - similar to shop operations, but without runtime and setup time
  obtain_method: z.string().optional().nullable(),
  parent_ids: z.array(z.number()).optional().nullable(),
  part_custom_attrs: z.array(z.unknown()).optional().nullable(),
  part_name: z.string().optional().nullable(),
  part_number: z.string().optional().nullable(),
  part_url: z.string().url().optional().nullable(),
  part_uuid: z.string().uuid().optional().nullable(),
  process: z.unknown().optional().nullable(),
  purchased_component: z.unknown().optional().nullable(), // TODO - object that leads to the purchased component table, can have shop operations,
  revision: z.string().optional().nullable(),
  shop_operations: z.array(ShopOperationSchema).optional().nullable(),
  supporting_files: z.array(z.unknown()).optional().nullable(),
  thumbnail_url: z.string().url().optional().nullable(),
  type: z.string().optional().nullable(),
  deliver_quantity: z.number().optional().nullable(),
  make_quantity: z.number().optional().nullable()
});

// Order item schema
export const OrderItemSchema = z.object({
  id: z.number().optional().nullable(),
  components: z.array(ComponentSchema).optional().nullable(),
  description: z.string().optional().nullable(),
  expedite_revenue: z.string().optional().nullable(), // API returns as string or null
  export_controlled: z.boolean().optional().nullable(),
  filename: z.string().optional().nullable(),
  lead_days: z.number().optional().nullable(),
  markup_1_price: z.string().optional().nullable(), // API returns as string
  markup_1_name: z.string().optional().nullable(),
  markup_2_price: z.string().optional().nullable(), // API returns as string
  markup_2_name: z.string().optional().nullable(),
  private_notes: z.string().optional().nullable(),
  public_notes: z.string().optional().nullable(),
  quantity: z.number().optional().nullable(),
  quantity_outstanding: z.number().optional().nullable(),
  quote_item_id: z.number().optional().nullable(),
  quote_item_type: z.enum(["automatic", "manual"]).optional().nullable(),
  root_component_id: z.number().optional().nullable(),
  ships_on: z.string().optional().nullable(), // Date string
  total_price: z.string().optional().nullable(), // API returns as string
  unit_price: z.string().optional().nullable(), // API returns as string
  base_price: z.string().optional().nullable(), // API returns as string
  add_on_fees: z.unknown().optional().nullable(),
  unit_price_before_discounts: z.string().optional().nullable(), // API returns as string
  ordered_add_ons: z.array(z.unknown()).optional().nullable(),
  pricing_items: z.array(z.unknown()).optional().nullable()
});

// Payment details schema
export const PaymentDetailsSchema = z.object({
  card_brand: z.string().optional().nullable(),
  card_last4: z.string().optional().nullable(),
  net_payout: z.string().optional().nullable(), // API returns as string
  payment_type: z.enum(["credit_card", "purchase_order"]).optional().nullable(),
  purchase_order_number: z.string().optional().nullable(),
  purchasing_dept_contact_email: z.string().email().optional().nullable(),
  purchasing_dept_contact_name: z.string().optional().nullable(),
  shipping_cost: z.string().optional().nullable(), // API returns as string
  subtotal: z.string().optional().nullable(), // API returns as string
  tax_cost: z.string().optional().nullable(), // API returns as string
  tax_rate: z.string().optional().nullable(), // API returns as string
  payment_terms: z.string().optional().nullable(),
  total_price: z.string().optional().nullable() // API returns as string
});

// Shipping option schema
export const ShippingOptionSchema = z.object({
  customers_account_number: z.string().optional().nullable(),
  customers_carrier: z.string().optional().nullable(),
  shipping_method: z.string().optional().nullable(),
  type: z.string().optional().nullable()
});

// Shipment schema
export const ShipmentSchema = z.array(z.unknown()); // Empty array in the example

// Main Order schema
export const OrderSchema = z.object({
  uuid: z.string().uuid().optional().nullable(),
  billing_info: AddressSchema.optional().nullable(),
  created: z.string().optional().nullable(), // Loosened datetime restriction
  contact: ContactSchema.optional().nullable(),
  customer: CustomerSchema.optional().nullable(),
  deliver_by: z.string().optional().nullable(),
  estimator: SalesPersonSchema.optional().nullable(),
  send_from_facility: FacilitySchema.optional().nullable(),
  erp_code: z.string().optional().nullable(),
  number: z.number().optional().nullable(),
  order_items: z.array(OrderItemSchema).optional().nullable(),
  payment_details: PaymentDetailsSchema.optional().nullable(),
  private_notes: z.string().optional().nullable(),
  purchase_order_file_url: z.string().url().optional().nullable(),
  quote_erp_code: z.string().optional().nullable(),
  quote_number: z.number().optional().nullable(),
  quote_revision_number: z.number().optional().nullable(),
  sales_person: SalesPersonSchema.optional().nullable(),
  salesperson: SalesPersonSchema.optional().nullable(),
  shipments: ShipmentSchema.optional().nullable(),
  shipping_info: AddressSchema.optional().nullable(),
  shipping_option: ShippingOptionSchema.optional().nullable(),
  ships_on: z.string().optional().nullable(), // Date string
  status: z
    .enum([
      "pending",
      "confirmed",
      "on_hold",
      "in_process",
      "completed",
      "cancelled"
    ])
    .optional()
    .nullable(),
  quote_rfq_number: z.string().optional().nullable()
});

// Export the inferred type
export type Order = z.infer<typeof OrderSchema>;
