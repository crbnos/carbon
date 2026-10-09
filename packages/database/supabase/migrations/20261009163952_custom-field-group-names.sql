-- Settings -> Custom Fields lists each group by "customFieldTable"."name". Several
-- names predate renames in the app; these match what the screens call each record.
-- Keyed by "table", so a rerun changes nothing.
UPDATE "customFieldTable"
SET "name" = v."name"
FROM (
  VALUES
    ('journal', 'Journal Entry'),
    ('journalLine', 'Journal Entry Line'),
    ('changeOrder', 'Change Notice'),
    ('itemCost', 'Item Costing & Posting'),
    ('itemPostingGroup', 'Item Group'),
    ('itemReplenishment', 'Item Manufacturing'),
    ('supplierPart', 'Supplier Part'),
    ('itemUnitSalePrice', 'Item Sale Price'),
    ('materialForm', 'Material Shape'),
    ('enforcementRule', 'Storage & Sales Rule'),
    ('supplierPayment', 'Supplier Payment Terms'),
    ('salesRfq', 'Sales RFQ'),
    ('salesRfqLine', 'Sales RFQ Line'),
    ('salesInvoiceShipment', 'Sales Invoice Shipping'),
    ('gaugeCalibrationRecord', 'Calibration Record')
) AS v("table", "name")
WHERE "customFieldTable"."table" = v."table";
