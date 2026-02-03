-- Register event system triggers for relevant tables
SELECT attach_event_trigger('contact');
SELECT attach_event_trigger('supplier');
SELECT attach_event_trigger('customer');
SELECT attach_event_trigger('salesOrder');
SELECT attach_event_trigger('salesOrderLine');
SELECT attach_event_trigger('purchaseOrder');
SELECT attach_event_trigger('purchaseOrderLine');
SELECT attach_event_trigger('item');
SELECT attach_event_trigger('job');
SELECT attach_event_trigger('salesInvoice');
SELECT attach_event_trigger('purchaseInvoice');