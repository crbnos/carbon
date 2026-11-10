-- 20260204080000_async-search-triggers.sql moved search indexing to the event
-- system and dropped these functions' triggers, but left the functions. They
-- still wrote links to pages that do not exist (/x/rfq/, /x/fixture/), and
-- populate_sales_search_results stayed callable through the API. No CASCADE:
-- a trigger that still uses one fails this migration instead of being dropped.
DROP FUNCTION sync_employee_to_search_index();
DROP FUNCTION sync_customer_to_search_index();
DROP FUNCTION sync_supplier_to_search_index();
DROP FUNCTION sync_item_to_search_index();
DROP FUNCTION sync_job_to_search_index();
DROP FUNCTION sync_purchase_order_to_search_index();
DROP FUNCTION sync_sales_invoice_to_search_index();
DROP FUNCTION sync_purchase_invoice_to_search_index();
DROP FUNCTION sync_non_conformance_to_search_index();
DROP FUNCTION sync_gauge_to_search_index();
DROP FUNCTION sync_quote_to_search_index();
DROP FUNCTION sync_sales_rfq_to_search_index();
DROP FUNCTION sync_sales_order_to_search_index();
DROP FUNCTION sync_supplier_quote_to_search_index();
DROP FUNCTION populate_sales_search_results(TEXT);
