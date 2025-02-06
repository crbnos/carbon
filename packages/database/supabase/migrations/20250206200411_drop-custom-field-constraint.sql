ALTER TABLE "tableView" DROP CONSTRAINT "tableView_table_fkey";

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES 
('salesOrder', 'Sales Order', 'Sales'),
('salesOrderLine', 'Sales Order Line', 'Sales');