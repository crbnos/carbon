// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "../types";

type Table = keyof Database["public"]["Tables"];

/**
 * What runs when a table's rows change.
 *
 * - `before` / `after`: interceptors, run for each row inside the writing
 *   transaction, in this order (`handlers/<name>.sql`).
 * - `events`: every change is queued for the event system (audit log, search
 *   index, webhooks, workflows, embeddings).
 * - `statement`: handlers run once per statement, e.g. the realtime broadcasts
 *   (`functions/broadcast_*.sql`) and the change log (`functions/log_*.sql`).
 */
export type Attachment = {
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  readonly events?: boolean;
  readonly statement?: readonly string[];
};

export type Attachments = { readonly [T in Table]?: Attachment };

/**
 * The event triggers of every table, and the only place they are declared.
 * `authz sync` makes a database match it; `authz migration` ships a change to
 * production. A migration never calls `attach_event_trigger`,
 * `attach_statement_handler` or `set_event_triggers`: each of those replaces a
 * table's whole list, so a call that forgot one function silently detached it.
 */
export const attachments = {
  ability: { statement: ["broadcast_reference_changes"] },
  address: { before: ["sync_address_to_parent"], events: true },
  assemblyPlanJob: { statement: ["broadcast_table_changes"] },
  changeOrder: { events: true, statement: ["broadcast_table_changes"] },
  changeOrderActionTask: { events: true },
  changeOrderAffectedItem: { events: true },
  changeOrderSupersession: { events: true },
  charge: { events: true },
  company: { after: ["sync_insert_company_related_records"] },
  companyIntegration: { before: ["sync_verify_integration"], events: true },
  contact: { before: ["sync_contact_to_parent"], events: true },
  customField: { statement: ["broadcast_table_changes"] },
  customer: {
    before: ["sync_update_customer_type_group"],
    after: ["sync_create_customer_entries", "sync_create_customer_org_group"],
    events: true,
    statement: ["broadcast_table_changes", "log_table_changes"]
  },
  customerAccount: {
    after: ["sync_add_customer_account_to_group"],
    events: true
  },
  customerContact: { statement: ["broadcast_reference_changes"] },
  customerItemPriceOverride: { events: true },
  customerItemPriceOverrideBreak: { events: true },
  customerLocation: { statement: ["broadcast_reference_changes"] },
  customerPartToItem: { events: true },
  customerPayment: { events: true },
  customerShipping: { events: true },
  customerTax: { events: true },
  customerType: {
    before: ["sync_update_customer_type_group_name"],
    after: ["sync_create_customer_type_group"],
    events: true,
    statement: ["broadcast_reference_changes"]
  },
  depreciationRun: { events: true },
  depreciationRunLine: { events: true },
  document: {
    before: ["sync_edit_document_transaction"],
    after: ["sync_upload_document_transaction"],
    events: true
  },
  documentExtraction: { statement: ["broadcast_table_changes"] },
  documentTemplate: { statement: ["broadcast_table_changes"] },
  employee: {
    before: ["sync_update_employee_type_membership"],
    after: ["sync_add_employee_to_type_group"],
    events: true,
    statement: ["broadcast_table_changes", "log_table_changes"]
  },
  employeeJob: { events: true },
  employeeType: {
    before: ["sync_update_employee_type_group"],
    after: ["sync_create_employee_type_group"],
    events: true
  },
  fixedAsset: { events: true },
  gauge: { events: true },
  gaugeCalibrationRecord: { events: true },
  implementationCheckState: { statement: ["broadcast_table_changes"] },
  implementationFieldValue: { statement: ["broadcast_table_changes"] },
  implementationHub: { statement: ["broadcast_table_changes"] },
  implementationRow: { statement: ["broadcast_table_changes"] },
  inspection: { statement: ["broadcast_table_changes"] },
  inspectionSample: { statement: ["broadcast_table_changes"] },
  inventoryCount: { events: true, statement: ["broadcast_table_changes"] },
  inventoryCountLine: { events: true, statement: ["broadcast_table_changes"] },
  invite: { events: true },
  invoiceSettlement: { events: true, statement: ["broadcast_table_changes"] },
  itarCertification: { events: true },
  item: {
    after: [
      "sync_create_item_related_records",
      "sync_create_make_method_related_records",
      "sync_propagate_item_readable_id_to_tracked_entity"
    ],
    events: true,
    statement: ["broadcast_table_changes", "log_table_changes"]
  },
  itemCost: { events: true },
  itemLedger: {
    statement: ["apply_item_stock_quantities", "broadcast_table_changes"]
  },
  itemPlanning: { events: true },
  itemPostingGroup: {
    events: true,
    statement: ["broadcast_reference_changes"]
  },
  itemReplenishment: { events: true },
  itemShelfLife: { events: true },
  itemStockQuantities: { statement: ["broadcast_table_changes"] },
  itemSupersession: {
    statement: ["broadcast_table_changes", "log_table_changes"]
  },
  itemUnitSalePrice: { events: true },
  job: {
    before: ["sync_job_complete_or_canceled"],
    after: ["sync_insert_job_make_method", "sync_job_recompute_service_line"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  jobMakeMethod: {
    before: [
      "sync_update_tracked_entity_on_job_make_method",
      "sync_delete_tracked_entity_on_job_make_method"
    ],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  jobMaterial: {
    before: [
      "sync_check_job_material_self_reference",
      "sync_update_job_material_make_method_item_id"
    ],
    after: ["sync_insert_job_material_make_method"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  jobOperation: {
    before: ["sync_finish_job_operation"],
    after: [
      "set_shelf_life_on_operation_done",
      "set_shelf_life_on_operation_started"
    ],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  jobOperationDependency: {
    after: ["sync_set_initial_dependency_status"],
    events: true
  },
  jobOperationNote: { statement: ["broadcast_table_changes"] },
  jobOperationStep: { statement: ["broadcast_table_changes"] },
  jobOperationStepRecord: { statement: ["broadcast_table_changes"] },
  journal: { events: true, statement: ["broadcast_table_changes"] },
  journalLine: { events: true },
  location: {
    after: ["sync_create_location_related_records"],
    events: true,
    statement: ["broadcast_reference_changes"]
  },
  maintenanceDispatch: {
    after: ["sync_on_maintenance_dispatch_complete"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  maintenanceDispatchComment: { events: true },
  maintenanceDispatchEvent: { events: true },
  maintenanceSchedule: { events: true },
  maintenanceScheduleItem: { events: true },
  material: { statement: ["broadcast_table_changes"] },
  materialForm: { statement: ["broadcast_table_changes"] },
  materialSubstance: { statement: ["broadcast_table_changes"] },
  materialType: { statement: ["broadcast_reference_changes"] },
  memo: { events: true },
  methodMaterial: {
    before: ["sync_check_method_material_self_reference"],
    events: true
  },
  modelUpload: { statement: ["broadcast_table_changes", "log_table_changes"] },
  nonConformance: { events: true, statement: ["broadcast_table_changes"] },
  nonConformanceActionTask: {
    events: true,
    statement: ["broadcast_table_changes"]
  },
  nonConformanceApprovalTask: { events: true },
  nonConformanceItem: { events: true, statement: ["broadcast_table_changes"] },
  nonConformanceRequiredAction: {
    before: ["sync_protect_system_required_actions"],
    events: true
  },
  nonConformanceSupplier: {
    after: ["sync_create_nc_external_link"],
    events: true
  },
  nonConformanceType: { statement: ["broadcast_reference_changes"] },
  notification: { statement: ["broadcast_user_changes"] },
  part: { statement: ["broadcast_table_changes"] },
  payment: { events: true, statement: ["broadcast_table_changes"] },
  paymentTerm: { statement: ["broadcast_reference_changes"] },
  pickingList: { events: true, statement: ["broadcast_table_changes"] },
  pickingListLine: { events: true, statement: ["broadcast_table_changes"] },
  printJob: { statement: ["broadcast_table_changes"] },
  procedure: {
    before: ["sync_archive_other_procedures"],
    events: true,
    statement: ["broadcast_reference_changes"]
  },
  process: { statement: ["broadcast_reference_changes"] },
  productionEvent: {
    before: ["sync_set_job_operation_in_progress"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  productionQuantity: {
    before: ["sync_update_job_operation_quantities"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  purchaseInvoice: {
    before: ["prevent_posted_purchase_invoice_deletion"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  purchaseInvoiceLine: {
    after: ["sync_purchase_invoice_line_price_change"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  purchaseOrder: { events: true, statement: ["broadcast_table_changes"] },
  purchaseOrderDelivery: { events: true },
  purchaseOrderLine: { events: true, statement: ["broadcast_table_changes"] },
  purchaseOrderPayment: { events: true },
  purchaseReturnOrder: { statement: ["broadcast_table_changes"] },
  purchaseReturnOrderLine: { statement: ["broadcast_table_changes"] },
  purchasingRfq: { statement: ["broadcast_table_changes"] },
  purchasingRfqLine: { statement: ["broadcast_table_changes"] },
  qualityDocument: {
    before: ["sync_archive_other_quality_documents"],
    events: true,
    statement: ["broadcast_reference_changes"]
  },
  quote: {
    before: ["sync_update_quote_exchange_rate"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  quoteLine: {
    before: ["sync_update_quote_line_make_method_item_id"],
    after: ["sync_insert_quote_line_make_method"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  quoteLinePrice: { statement: ["broadcast_table_changes"] },
  quoteMakeMethod: { statement: ["broadcast_table_changes"] },
  quoteMaterial: {
    before: ["sync_update_quote_material_make_method_item_id"],
    after: ["sync_insert_quote_material_make_method"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  quoteOperation: { statement: ["broadcast_table_changes"] },
  receipt: { events: true, statement: ["broadcast_table_changes"] },
  receiptLine: { events: true, statement: ["broadcast_table_changes"] },
  reimbursement: { events: true },
  reimbursementLine: { events: true },
  revenueRecognitionRun: { events: true },
  revenueRecognitionRunLine: { events: true },
  salesInvoice: {
    before: ["prevent_posted_sales_invoice_deletion"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  salesInvoiceLine: { events: true, statement: ["broadcast_table_changes"] },
  salesInvoiceShipment: { events: true },
  salesOrder: {
    before: ["sync_update_sales_order_exchange_rate"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  salesOrderLine: { events: true, statement: ["broadcast_table_changes"] },
  salesOrderPayment: { events: true },
  salesOrderShipment: { events: true },
  salesReturnOrder: { statement: ["broadcast_table_changes"] },
  salesReturnOrderLine: { statement: ["broadcast_table_changes"] },
  salesRfq: { events: true, statement: ["broadcast_table_changes"] },
  salesRfqLine: { statement: ["broadcast_table_changes"] },
  shipment: { events: true, statement: ["broadcast_table_changes"] },
  shipmentLine: { events: true, statement: ["broadcast_table_changes"] },
  shippingMethod: { statement: ["broadcast_reference_changes"] },
  stockTransfer: { events: true, statement: ["broadcast_table_changes"] },
  stockTransferLine: {
    after: ["sync_update_stock_transfer_status"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  storageUnit: {
    before: [
      "storage_unit_enforce_same_location",
      "storage_unit_block_location_change_with_children",
      "storage_unit_enforce_no_cycle"
    ],
    events: true,
    statement: ["broadcast_reference_changes"]
  },
  supplier: {
    before: ["sync_update_supplier_type_group"],
    after: ["sync_create_supplier_entries", "sync_create_supplier_org_group"],
    events: true,
    statement: ["broadcast_table_changes", "log_table_changes"]
  },
  supplierAccount: {
    after: ["sync_add_supplier_account_to_group"],
    events: true
  },
  supplierContact: { statement: ["broadcast_reference_changes"] },
  supplierLocation: { statement: ["broadcast_reference_changes"] },
  supplierPart: { events: true },
  supplierPayment: { events: true },
  supplierProcess: { statement: ["broadcast_reference_changes"] },
  supplierQuote: { events: true, statement: ["broadcast_table_changes"] },
  supplierQuoteLine: { events: true, statement: ["broadcast_table_changes"] },
  supplierShipping: { events: true },
  supplierTax: { events: true },
  supplierType: {
    before: ["sync_update_supplier_type_group_name"],
    after: ["sync_create_supplier_type_group"],
    events: true,
    statement: ["broadcast_reference_changes"]
  },
  trackedActivity: { statement: ["broadcast_table_changes"] },
  trackedEntity: { statement: ["broadcast_table_changes"] },
  unitOfMeasure: { statement: ["broadcast_reference_changes"] },
  user: {
    after: [
      "sync_create_user_identity_group",
      "sync_update_user_identity_group",
      "sync_delete_user_identity_group"
    ],
    statement: ["log_user_changes"]
  },
  warehouseTransfer: { events: true, statement: ["broadcast_table_changes"] },
  warehouseTransferLine: {
    events: true,
    statement: ["broadcast_table_changes"]
  },
  webhook: { after: ["sync_webhook_subscription"], events: true },
  workCenter: { events: true, statement: ["broadcast_reference_changes"] },
  workCenterProcess: { events: true },
  workflowRun: { statement: ["broadcast_table_changes"] },
  workflowStepRun: { statement: ["broadcast_table_changes"] }
} as const satisfies Attachments;

export type AttachedTable = keyof typeof attachments;
