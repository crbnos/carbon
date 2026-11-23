-- Index the foreign keys that app reads filter on.
--
-- Candidates: every foreign key with no index that starts with its columns, on
-- a table with more than 1,000 rows in production (504 keys, 252 on such tables).
-- Indexed: a key a read filters on (`.eq` / `.in` / `.where` on the column) and
-- that no index already serves, either by starting with the key's first column
-- or with ("companyId", <column>). 44 keys.
--
-- Not indexed: keys whose parent the app deletes but that no read filters on
-- (users, units of measure, accounts, lookup tables). Those deletes are rare and
-- every insert and update of the large child table would pay for the index.
--
-- Measured as an RLS user, 3,000 copies over 96 companies, lookup by the key:
--   supplierPart.supplierId              0.43 -> 0.04 ms (42,014 rows)
--   purchaseInvoiceLine.purchaseOrderLineId  0.23 -> 0.07 ms (24,008 rows)
--   pickMethod.locationId                2.36 -> 0.09 ms (57,019 rows)

CREATE INDEX IF NOT EXISTS "customerContact_contactId_idx" ON "customerContact" ("contactId"); -- references contact, reads=3
CREATE INDEX IF NOT EXISTS "customerLocation_customerId_idx" ON "customerLocation" ("customerId", "companyId"); -- references customer, reads=8
CREATE INDEX IF NOT EXISTS "demandActual_periodId_idx" ON "demandActual" ("periodId"); -- references period, reads=2
CREATE INDEX IF NOT EXISTS "demandForecast_periodId_idx" ON "demandForecast" ("periodId"); -- references period, reads=4
CREATE INDEX IF NOT EXISTS "demandProjection_periodId_idx" ON "demandProjection" ("periodId"); -- references period, reads=5
CREATE INDEX IF NOT EXISTS "demandProjection_locationId_idx" ON "demandProjection" ("locationId"); -- references location, reads=4
CREATE INDEX IF NOT EXISTS "itemCost_itemPostingGroupId_idx" ON "itemCost" ("itemPostingGroupId"); -- references itemPostingGroup, reads=2
CREATE INDEX IF NOT EXISTS "itemPlanning_responsibleEmployee_idx" ON "itemPlanning" ("responsibleEmployee"); -- references user, reads=1
CREATE INDEX IF NOT EXISTS "itemPlanning_locationId_idx" ON "itemPlanning" ("locationId"); -- references location, reads=3
CREATE INDEX IF NOT EXISTS "job_salesOrderId_idx" ON "job" ("salesOrderId"); -- references salesOrder, reads=4
CREATE INDEX IF NOT EXISTS "job_itemId_idx" ON "job" ("itemId"); -- references item, reads=3
CREATE INDEX IF NOT EXISTS "job_locationId_idx" ON "job" ("locationId"); -- references location, reads=10
CREATE INDEX IF NOT EXISTS "jobOperation_processId_idx" ON "jobOperation" ("processId"); -- references process, reads=2
CREATE INDEX IF NOT EXISTS "jobOperationStep_nonConformanceActionId_idx" ON "jobOperationStep" ("nonConformanceActionId"); -- references nonConformanceActionTask, reads=1
CREATE INDEX IF NOT EXISTS "journal_reversalOfId_idx" ON "journal" ("reversalOfId"); -- references journal, reads=1
CREATE INDEX IF NOT EXISTS "maintenanceDispatch_maintenanceScheduleId_idx" ON "maintenanceDispatch" ("maintenanceScheduleId"); -- references maintenanceSchedule, reads=1
CREATE INDEX IF NOT EXISTS "nonConformanceItem_itemId_idx" ON "nonConformanceItem" ("itemId"); -- references item, reads=4
CREATE INDEX IF NOT EXISTS "notification_digestedInto_idx" ON "notification" ("digestedInto"); -- references notification, reads=11
CREATE INDEX IF NOT EXISTS "pickMethod_locationId_idx" ON "pickMethod" ("locationId"); -- references location, reads=23
CREATE INDEX IF NOT EXISTS "purchaseInvoice_supplierInteractionId_idx" ON "purchaseInvoice" ("supplierInteractionId"); -- references supplierInteraction, reads=2
CREATE INDEX IF NOT EXISTS "purchaseInvoiceLine_purchaseOrderLineId_idx" ON "purchaseInvoiceLine" ("purchaseOrderLineId"); -- references purchaseOrderLine, reads=2
CREATE INDEX IF NOT EXISTS "purchaseInvoiceLine_purchaseOrderId_idx" ON "purchaseInvoiceLine" ("purchaseOrderId"); -- references purchaseOrder, reads=2
CREATE INDEX IF NOT EXISTS "purchaseInvoiceLine_itemId_idx" ON "purchaseInvoiceLine" ("itemId"); -- references item, reads=1
CREATE INDEX IF NOT EXISTS "purchaseOrder_supplierInteractionId_idx" ON "purchaseOrder" ("supplierInteractionId"); -- references supplierInteraction, reads=1
CREATE INDEX IF NOT EXISTS "purchaseOrderLine_assetId_idx" ON "purchaseOrderLine" ("assetId"); -- references fixedAsset, reads=1
CREATE INDEX IF NOT EXISTS "quote_externalLinkId_idx" ON "quote" ("externalLinkId"); -- references externalLink, reads=1
CREATE INDEX IF NOT EXISTS "receipt_supplierInteractionId_idx" ON "receipt" ("supplierInteractionId"); -- references supplierInteraction, reads=2
CREATE INDEX IF NOT EXISTS "salesInvoice_opportunityId_idx" ON "salesInvoice" ("opportunityId"); -- references opportunity, reads=1
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_assetId_idx" ON "salesInvoiceLine" ("assetId"); -- references fixedAsset, reads=1
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_salesOrderLineId_idx" ON "salesInvoiceLine" ("salesOrderLineId"); -- references salesOrderLine, reads=1
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_salesOrderId_idx" ON "salesInvoiceLine" ("salesOrderId"); -- references salesOrder, reads=2
CREATE INDEX IF NOT EXISTS "salesOrder_opportunityId_idx" ON "salesOrder" ("opportunityId"); -- references opportunity, reads=1
CREATE INDEX IF NOT EXISTS "salesOrder_locationId_idx" ON "salesOrder" ("locationId"); -- references location, reads=1
CREATE INDEX IF NOT EXISTS "salesOrderLine_assetId_idx" ON "salesOrderLine" ("assetId"); -- references fixedAsset, reads=1
CREATE INDEX IF NOT EXISTS "shipment_opportunityId_idx" ON "shipment" ("opportunityId"); -- references opportunity, reads=2
CREATE INDEX IF NOT EXISTS "shipment_supplierInteractionId_idx" ON "shipment" ("supplierInteractionId"); -- references supplierInteraction, reads=1
CREATE INDEX IF NOT EXISTS "storageUnit_locationId_idx" ON "storageUnit" ("locationId"); -- references location, reads=6
CREATE INDEX IF NOT EXISTS "supplier_supplierTypeId_idx" ON "supplier" ("supplierTypeId"); -- references supplierType, reads=1
CREATE INDEX IF NOT EXISTS "supplierContact_contactId_idx" ON "supplierContact" ("contactId"); -- references contact, reads=1
CREATE INDEX IF NOT EXISTS "supplierLocation_supplierId_idx" ON "supplierLocation" ("supplierId", "companyId"); -- references supplier, reads=6
CREATE INDEX IF NOT EXISTS "supplierPart_supplierId_idx" ON "supplierPart" ("supplierId", "companyId"); -- references supplier, reads=19
CREATE INDEX IF NOT EXISTS "supplyActual_periodId_idx" ON "supplyActual" ("periodId"); -- references period, reads=1
CREATE INDEX IF NOT EXISTS "workCenter_locationId_idx" ON "workCenter" ("locationId"); -- references location, reads=2
CREATE INDEX IF NOT EXISTS "workCenter_departmentId_idx" ON "workCenter" ("departmentId"); -- references department, reads=1
