-- address
ALTER TABLE "address" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view or purchasing_view can view addresses" ON "address"
FOR SELECT USING (
  has_role('employee', "companyId") AND 
  (has_company_permission('sales_view', "companyId") OR has_company_permission('purchasing_view', "companyId"))
);

CREATE POLICY "Employees with sales_create or purchasing_create can create addresses" ON "address"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND 
  (has_company_permission('sales_create', "companyId") OR has_company_permission('purchasing_create', "companyId"))
);

CREATE POLICY "Employees with sales_update or purchasing_update can update addresses" ON "address"
FOR UPDATE USING (
  has_role('employee', "companyId") AND 
  (has_company_permission('sales_update', "companyId") OR has_company_permission('purchasing_update', "companyId"))
);

CREATE POLICY "Employees with sales_delete or purchasing_delete can delete addresses" ON "address"
FOR DELETE USING (
  has_role('employee', "companyId") AND 
  (has_company_permission('sales_delete', "companyId") OR has_company_permission('purchasing_delete', "companyId"))
);

CREATE POLICY "Requests with an API key can access addresses" ON "address"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- contractor
CREATE POLICY "Requests with an API key can access contractors" ON "contractor"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- contractorAbility
CREATE POLICY "Requests with an API key can access contractor abilities" ON "contractorAbility"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("contractorId", 'contractor'))
);

-- costLedger 
CREATE POLICY "Requests with an API key can access value ledger" ON "costLedger"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- country 
ALTER TABLE "country" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view countries" ON "country" FOR SELECT USING (auth.role() = 'authenticated');

-- currency
CREATE POLICY "Requests with an API key can access currency" ON "currency"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- customer
CREATE POLICY "Requests with an API key can access customers" ON "customer"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- customerAccount
ALTER TABLE "customerAccount" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view customer accounts" ON "customerAccount"
FOR SELECT USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_view', "companyId")
);

CREATE POLICY "Employees with sales_create can create customer accounts" ON "customerAccount"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_create', "companyId")
);

CREATE POLICY "Employees with sales_update can update customer accounts" ON "customerAccount"
FOR UPDATE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_update', "companyId")
);

CREATE POLICY "Employees with sales_delete can delete customer accounts" ON "customerAccount"
FOR DELETE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_delete', "companyId")
);

CREATE POLICY "Requests with an API key can access customer accounts" ON "customerAccount"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- customerContact
CREATE POLICY "Requests with an API key can access customer contacts" ON "customerContact"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("customerId", 'customer'))
);

-- customerLocation
ALTER TABLE "customerLocation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view customer locations" ON "customerLocation"
FOR SELECT USING (
  has_role('employee', get_company_id_from_foreign_key("customerId", 'customer')) AND 
  has_company_permission('sales_view', get_company_id_from_foreign_key("customerId", 'customer'))
);

CREATE POLICY "Employees with sales_create can create customer locations" ON "customerLocation"
FOR INSERT WITH CHECK (
  has_role('employee', get_company_id_from_foreign_key("customerId", 'customer')) AND 
  has_company_permission('sales_create', get_company_id_from_foreign_key("customerId", 'customer'))
);

CREATE POLICY "Employees with sales_update can update customer locations" ON "customerLocation"
FOR UPDATE USING (
  has_role('employee', get_company_id_from_foreign_key("customerId", 'customer')) AND 
  has_company_permission('sales_update', get_company_id_from_foreign_key("customerId", 'customer'))
);

CREATE POLICY "Employees with sales_delete can delete customer locations" ON "customerLocation"
FOR DELETE USING (
  has_role('employee', get_company_id_from_foreign_key("customerId", 'customer')) AND 
  has_company_permission('sales_delete', get_company_id_from_foreign_key("customerId", 'customer'))
);

CREATE POLICY "Requests with an API key can access customer locations" ON "customerLocation"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("customerId", 'customer'))
);

-- customerPartToItem
CREATE POLICY "Requests with an API key can access customer parts" ON "customerPartToItem"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- customerPayment
CREATE POLICY "Requests with an API key can access customer payments" ON "customerPayment"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- customerShipping
CREATE POLICY "Requests with an API key can access customer shipments" ON "customerShipping"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- customerStatus
ALTER TABLE "customerStatus" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view customer statuses" ON "customerStatus"
FOR SELECT USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_view', "companyId")
);

CREATE POLICY "Employees with sales_create can create customer statuses" ON "customerStatus"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_create', "companyId")
);

CREATE POLICY "Employees with sales_update can update customer statuses" ON "customerStatus"
FOR UPDATE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_update', "companyId")
);

CREATE POLICY "Employees with sales_delete can delete customer statuses" ON "customerStatus"
FOR DELETE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_delete', "companyId")
);

CREATE POLICY "Requests with an API key can access customer statuses" ON "customerStatus"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- customerType
CREATE POLICY "Requests with an API key can access customer types" ON "customerType"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- customField
CREATE POLICY "Requests with an API key can access custom fields" ON "customField"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- department
CREATE POLICY "Requests with an API key can access departments" ON "department"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- document
CREATE POLICY "Requests with an API key can access documents" ON "document"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- documentFavorite
CREATE POLICY "Requests with an API key can access document favorites" ON "documentFavorite"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("documentId", 'document'))
);

-- documentLabel
CREATE POLICY "Requests with an API key can access document labels" ON "documentLabel"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("documentId", 'document'))
);

-- documentTransaction
CREATE POLICY "Requests with an API key can access document transactions" ON "documentTransaction"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("documentId", 'document'))
);

-- employee
CREATE POLICY "Requests with an API key can access employees" ON "employee"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- employeeAbility
CREATE POLICY "Requests with an API key can access employee abilities" ON "employeeAbility"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("employeeId", 'user'))
);

-- employeeJob
CREATE POLICY "Requests with an API key can access employee jobs" ON "employeeJob"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- employeeShift
CREATE POLICY "Requests with an API key can access employee shifts" ON "employeeShift"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("employeeId", 'user'))
);

-- employeeType
CREATE POLICY "Requests with an API key can access employee types" ON "employeeType"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- employeeTypePermission
CREATE POLICY "Requests with an API key can access employee type permissions" ON "employeeTypePermission"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("employeeTypeId", 'employeeType'))
);

-- fiscalYearSettings
ALTER TABLE "fiscalYearSettings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with settings_view can view fiscal year settings" ON "fiscalYearSettings"
FOR SELECT USING (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_view', "companyId")
);

CREATE POLICY "Employees with settings_create can create fiscal year settings" ON "fiscalYearSettings"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_create', "companyId")
);

CREATE POLICY "Employees with settings_update can update fiscal year settings" ON "fiscalYearSettings"
FOR UPDATE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_update', "companyId")
);

CREATE POLICY "Employees with settings_delete can delete fiscal year settings" ON "fiscalYearSettings"
FOR DELETE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_delete', "companyId")
);

CREATE POLICY "Requests with an API key can access fiscal year settings" ON "fiscalYearSettings"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- fixture
CREATE POLICY "Requests with an API key can access fixtures" ON "fixture"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- group
ALTER TABLE "group" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requests with an API key can access groups" ON "group"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Employees with settings_view can view groups" ON "group"
FOR SELECT USING (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_view', "companyId")
);

CREATE POLICY "Employees with settings_create can create groups" ON "group"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_create', "companyId")
);

CREATE POLICY "Employees with settings_update can update groups" ON "group"
FOR UPDATE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_update', "companyId")
);

CREATE POLICY "Employees with settings_delete can delete groups" ON "group"
FOR DELETE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_delete', "companyId")
);

CREATE POLICY "Requests with an API key can access groups" ON "group"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- holiday
CREATE POLICY "Requests with an API key can access holidays" ON "holiday"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- item
CREATE POLICY "Requests with an API key can access items" ON "item"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- itemCost
CREATE POLICY "Requests with an API key can access item costs" ON "itemCost"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- itemLedger
CREATE POLICY "Requests with an API key can access item ledger" ON "itemLedger"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- itemPlanning
CREATE POLICY "Requests with an API key can access item planning" ON "itemPlanning"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- itemPostingGroup
CREATE POLICY "Requests with an API key can access item posting groups" ON "itemPostingGroup"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- itemReplenishment
CREATE POLICY "Requests with an API key can access item replenishment" ON "itemReplenishment"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- itemUnitSalePrice
CREATE POLICY "Requests with an API key can access item unit sale prices" ON "itemUnitSalePrice"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- journal
CREATE POLICY "Requests with an API key can access journals" ON "journal"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- journalLine
CREATE POLICY "Requests with an API key can access journal lines" ON "journalLine"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- location
CREATE POLICY "Requests with an API key can access locations" ON "location"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- makeMethod
CREATE POLICY "Requests with an API key can access make methods" ON "makeMethod"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- material
CREATE POLICY "Requests with an API key can access materials" ON "material"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- materialForm
CREATE POLICY "Requests with an API key can access material forms" ON "materialForm"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- materialSubstance
CREATE POLICY "Requests with an API key can access material substances" ON "materialSubstance"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- membership
CREATE POLICY "Requests with an API key can access memberships" ON "membership"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("groupId", 'group'))
);

-- methodMaterial
CREATE POLICY "Requests with an API key can access method materials" ON "methodMaterial"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- methodOperation
CREATE POLICY "Requests with an API key can access method operations" ON "methodOperation"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- methodOperationWorkInstruction
CREATE POLICY "Requests with an API key can access method operation work instructions" ON "methodOperationWorkInstruction"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- modelUpload
CREATE POLICY "Requests with an API key can access model uploads" ON "modelUpload"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- note
CREATE POLICY "Requests with an API key can access notes" ON "note"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- opportunity
CREATE POLICY "Requests with an API key can access opportunities" ON "opportunity"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- part
CREATE POLICY "Requests with an API key can access parts" ON "part"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- partner
CREATE POLICY "Requests with an API key can access partners" ON "partner"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- paymentTerm
CREATE POLICY "Requests with an API key can access payment terms" ON "paymentTerm"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- pickMethod
CREATE POLICY "Requests with an API key can access pick methods" ON "pickMethod"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- postingGroupInventory
CREATE POLICY "Requests with an API key can access inventory posting groups" ON "postingGroupInventory"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- postingGroupPurchasing
CREATE POLICY "Requests with an API key can access purchasing posting groups" ON "postingGroupPurchasing"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- postingGroupSales
ALTER TABLE "postingGroupSales" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requests with an API key can access sales posting groups" ON "postingGroupSales"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- process
CREATE POLICY "Requests with an API key can access processes" ON "process"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- purchaseInvoice
CREATE POLICY "Requests with an API key can access purchase invoices" ON "purchaseInvoice"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- purchaseInvoiceLine
CREATE POLICY "Requests with an API key can access purchase invoice lines" ON "purchaseInvoiceLine"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- purchaseInvoicePaymentRelation
CREATE POLICY "Requests with an API key can access purchase invoice payment relations" ON "purchaseInvoicePaymentRelation"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("invoiceId", 'purchaseInvoice'))
);

-- purchaseInvoicePriceChange
CREATE POLICY "Requests with an API key can access purchase invoice price changes" ON "purchaseInvoicePriceChange"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("invoiceId", 'purchaseInvoice'))
);

-- purchaseInvoiceStatusHistory
CREATE POLICY "Requests with an API key can access purchase invoice status history" ON "purchaseInvoiceStatusHistory"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("invoiceId", 'purchaseInvoice'))
);

-- purchaseOrder
CREATE POLICY "Requests with an API key can access purchase orders" ON "purchaseOrder"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- purchaseOrderDelivery
CREATE POLICY "Requests with an API key can access purchase order deliveries" ON "purchaseOrderDelivery"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- purchaseOrderFavorite
CREATE POLICY "Requests with an API key can access purchase order favorites" ON "purchaseOrderFavorite"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("purchaseOrderId", 'purchaseOrder'))
);

-- purchaseOrderLine
CREATE POLICY "Requests with an API key can access purchase order lines" ON "purchaseOrderLine"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- purchaseOrderPayment
CREATE POLICY "Requests with an API key can access purchase order payments" ON "purchaseOrderPayment"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- purchaseOrderStatusHistory
CREATE POLICY "Requests with an API key can access purchase order status history" ON "purchaseOrderStatusHistory"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("purchaseOrderId", 'purchaseOrder'))
);

-- purchaseOrderTransaction
CREATE POLICY "Requests with an API key can access purchase order transactions" ON "purchaseOrderTransaction"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("purchaseOrderId", 'purchaseOrder'))
);

-- purchasePayment
CREATE POLICY "Requests with an API key can access purchase payments" ON "purchasePayment"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- quote
CREATE POLICY "Requests with an API key can access quotes" ON "quote"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- quoteFavorite
CREATE POLICY "Requests with an API key can access quote favorites" ON "quoteFavorite"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("quoteId", 'quote'))
);

-- quoteLine
CREATE POLICY "Requests with an API key can access quote lines" ON "quoteLine"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- quoteLinePrice
CREATE POLICY "Requests with an API key can access quote line prices" ON "quoteLinePrice"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("quoteId", 'quote'))
);

-- quoteMakeMethod
CREATE POLICY "Requests with an API key can access quote make methods" ON "quoteMakeMethod"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- quoteMaterial
CREATE POLICY "Requests with an API key can access quote materials" ON "quoteMaterial"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- quoteOperation
CREATE POLICY "Requests with an API key can access quote operations" ON "quoteOperation"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- quoteOperationWorkInstruction
CREATE POLICY "Requests with an API key can access quote operation work instructions" ON "quoteOperationWorkInstruction"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("quoteOperationId", 'quoteOperation'))
);

-- receipt
CREATE POLICY "Requests with an API key can access receipts" ON "receipt"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- receiptLine
CREATE POLICY "Requests with an API key can access receipt lines" ON "receiptLine"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- salesOrder
CREATE POLICY "Requests with an API key can access requests for sales order" ON "salesOrder"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- salesOrderFavorite
CREATE POLICY "Requests with an API key can access requests for sales order favorites" ON "salesOrderFavorite"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("salesOrderId", 'salesOrder'))
);

-- salesOrderLine
CREATE POLICY "Requests with an API key can access requests for sales order lines" ON "salesOrderLine"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- salesOrderPayment
CREATE POLICY "Requests with an API key can access requests for sales order payments" ON "salesOrderPayment"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- salesOrderShipment
CREATE POLICY "Requests with an API key can access requests for sales order shipments" ON "salesOrderShipment"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- salesOrderStatusHistory
CREATE POLICY "Requests with an API key can access requests for sales order status history" ON "salesOrderStatusHistory"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("salesOrderId", 'salesOrder'))
);

-- salesOrderTransaction 
ALTER TABLE "salesOrderTransaction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requests with an API key can access sales order transactions" ON "salesOrderTransaction"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("salesOrderId", 'salesOrder'))
);

-- salesRfq
CREATE POLICY "Requests with an API key can access sales RFQs" ON "salesRfq"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- salesRfqFavorite
CREATE POLICY "Requests with an API key can access sales RFQ favorites" ON "salesRfqFavorite"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("rfqId", 'salesRfq'))
);

-- salesRfqLine
CREATE POLICY "Requests with an API key can access sales RFQ lines" ON "salesRfqLine"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- sequence
ALTER TABLE "sequence" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with settings_view can view sequences" ON "sequence"
FOR SELECT USING (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_view', "companyId")
);

CREATE POLICY "Employees with settings_create can create sequences" ON "sequence"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_create', "companyId")
);

CREATE POLICY "Employees with settings_update can update sequences" ON "sequence"
FOR UPDATE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_update', "companyId")
);

CREATE POLICY "Employees with settings_delete can delete sequences" ON "sequence"
FOR DELETE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('settings_delete', "companyId")
);

CREATE POLICY "Requests with an API key can access sequences" ON "sequence"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- service
ALTER TABLE "service" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requests with an API key can access services" ON "service"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- shelf
CREATE POLICY "Requests with an API key can access shelves" ON "shelf"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- shift
CREATE POLICY "Requests with an API key can access shifts" ON "shift"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- shippingMethod
ALTER TABLE "shippingMethod" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requests with an API key can access shipping methods" ON "shippingMethod"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- shippingTerm
CREATE POLICY "Requests with an API key can access shipping terms" ON "shippingTerm"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- supplier
CREATE POLICY "Requests with an API key can access suppliers" ON "supplier"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- supplierAccount
ALTER TABLE "supplierAccount" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view supplier accounts" ON "supplierAccount"
FOR SELECT USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_view', "companyId")
);

CREATE POLICY "Employees with purchasing_create can create supplier accounts" ON "supplierAccount"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_create', "companyId")
);

CREATE POLICY "Employees with purchasing_update can update supplier accounts" ON "supplierAccount"
FOR UPDATE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_update', "companyId")
);

CREATE POLICY "Employees with purchasing_delete can delete supplier accounts" ON "supplierAccount"
FOR DELETE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_delete', "companyId")
);

CREATE POLICY "Requests with an API key can access supplier accounts" ON "supplierAccount"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- supplierContact
CREATE POLICY "Requests with an API key can access supplier contacts" ON "supplierContact"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("supplierId", 'supplier'))
);

-- supplierLedger
CREATE POLICY "Requests with an API key can access supplier ledger" ON "supplierLedger"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- supplierLocation
ALTER TABLE "supplierLocation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view supplier locations" ON "supplierLocation"
FOR SELECT USING (
  has_role('employee', get_company_id_from_foreign_key("supplierId", 'supplier')) AND 
  has_company_permission('sales_view', get_company_id_from_foreign_key("supplierId", 'supplier'))
);

CREATE POLICY "Employees with purchasing_create can create supplier locations" ON "supplierLocation"
FOR INSERT WITH CHECK (
  has_role('employee', get_company_id_from_foreign_key("supplierId", 'supplier')) AND 
  has_company_permission('sales_create', get_company_id_from_foreign_key("supplierId", 'supplier'))
);

CREATE POLICY "Employees with purchasing_update can update supplier locations" ON "supplierLocation"
FOR UPDATE USING (
  has_role('employee', get_company_id_from_foreign_key("supplierId", 'supplier')) AND 
  has_company_permission('sales_update', get_company_id_from_foreign_key("supplierId", 'supplier'))
);

CREATE POLICY "Employees with purchasing_delete can delete supplier locations" ON "supplierLocation"
FOR DELETE USING (
  has_role('employee', get_company_id_from_foreign_key("supplierId", 'supplier')) AND 
  has_company_permission('sales_delete', get_company_id_from_foreign_key("supplierId", 'supplier'))
);

CREATE POLICY "Requests with an API key can access supplier locations" ON "supplierLocation"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("supplierId", 'supplier'))
);

-- supplierPayment
CREATE POLICY "Requests with an API key can access supplier payments" ON "supplierPayment"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- supplierShipping
CREATE POLICY "Requests with an API key can access supplier shipping" ON "supplierShipping"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- supplierStatus
ALTER TABLE "supplierStatus" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view supplier statuses" ON "supplierStatus"
FOR SELECT USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_view', "companyId")
);

CREATE POLICY "Employees with purchasing_create can create supplier statuses" ON "supplierStatus"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_create', "companyId")
);

CREATE POLICY "Employees with purchasing_update can update supplier statuses" ON "supplierStatus"
FOR UPDATE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_update', "companyId")
);

CREATE POLICY "Employees with purchasing_delete can delete supplier statuses" ON "supplierStatus"
FOR DELETE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('sales_delete', "companyId")
);

CREATE POLICY "Requests with an API key can access supplier statuses" ON "supplierStatus"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- supplierType
CREATE POLICY "Requests with an API key can access supplier types" ON "supplierType"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- tool
CREATE POLICY "Requests with an API key can access tools" ON "tool"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- unitOfMeasure
CREATE POLICY "Requests with an API key can access units of measure" ON "unitOfMeasure"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- warehouse
CREATE POLICY "Requests with an API key can access warehouses" ON "warehouse"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- workCenter
CREATE POLICY "Requests with an API key can access work centers" ON "workCenter"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- workCenterProcess
CREATE POLICY "Requests with an API key can access work center processes" ON "workCenterProcess"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);