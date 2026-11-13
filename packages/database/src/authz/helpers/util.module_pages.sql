CREATE OR REPLACE FUNCTION util.module_pages(p_module text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- Generated from packages/database/src/access/pages (authz/registry-sql.ts). Do not edit.
  -- The pages of a module, in sidebar order; empty for anything else.
  SELECT CASE p_module
    WHEN 'accounting' THEN ARRAY['accounting.reporting', 'accounting.syncTieOut', 'accounting.journalEntries', 'accounting.intercompany', 'accounting.accountingPeriods', 'accounting.depreciation', 'accounting.indirectRates', 'accounting.leases', 'accounting.revenueRecognition', 'accounting.assets', 'accounting.fleet', 'accounting.assetClasses', 'accounting.chartOfAccounts', 'accounting.costCenters', 'accounting.defaultAccounts', 'accounting.dimensions', 'accounting.exchangeRates', 'accounting.fiscalYear', 'accounting.indirectPools', 'accounting.paymentTerms', 'accounting.bankAccounts']
    WHEN 'documents' THEN ARRAY['documents']
    WHEN 'inventory' THEN ARRAY['inventory.quantities', 'inventory.movements', 'inventory.inventoryCount', 'inventory.kanbans', 'inventory.receipts', 'inventory.shipments', 'inventory.pickingLists', 'inventory.stockTransfers', 'inventory.warehouseTransfers', 'inventory.trackedEntities', 'inventory.traceability', 'inventory.storageUnits', 'inventory.storageTypes', 'inventory.storageRules', 'inventory.shippingMethods']
    WHEN 'invoicing' THEN ARRAY['invoicing.payables', 'invoicing.purchaseInvoices', 'invoicing.supplierCredits', 'invoicing.charges', 'invoicing.reimbursements', 'invoicing.receivables', 'invoicing.salesInvoices', 'invoicing.creditMemos', 'invoicing.payments']
    WHEN 'parts' THEN ARRAY['parts.parts', 'parts.materials', 'parts.tools', 'parts.consumables', 'parts.services', 'parts.changeNotices', 'parts.changeNoticeTypes', 'parts.changeNoticeActions', 'parts.dimensions', 'parts.finishes', 'parts.grades', 'parts.shapes', 'parts.substances', 'parts.types', 'parts.itemGroups', 'parts.units']
    WHEN 'people' THEN ARRAY['people.employees', 'people.timecards', 'people.attributes', 'people.departments', 'people.holidays', 'people.shifts', 'people.payrollTotals']
    WHEN 'production' THEN ARRAY['production.jobs', 'production.batches', 'production.unattributedTime', 'production.demandForecasts', 'production.materialPlanning', 'production.resourcePlanning', 'production.forecast', 'production.priorities', 'production.outbound', 'production.assemblies', 'production.procedures', 'production.scrapReasons']
    WHEN 'projects' THEN ARRAY['projects.projects', 'projects.approvals', 'projects.reports', 'projects.laborCategories', 'projects.planningGroups']
    WHEN 'purchasing' THEN ARRAY['purchasing.suppliers', 'purchasing.purchaseOrders', 'purchasing.returns', 'purchasing.leases', 'purchasing.materialPlanning', 'purchasing.rfqs', 'purchasing.supplierQuotes', 'purchasing.supplierStages', 'purchasing.types']
    WHEN 'quality' THEN ARRAY['quality.actions', 'quality.issues', 'quality.risks', 'quality.gauges', 'quality.records', 'quality.inspections', 'quality.inspectionPlans', 'quality.qualityDocuments', 'quality.actionTypes', 'quality.gaugeTypes', 'quality.issueTypes', 'quality.issueWorkflows']
    WHEN 'resources' THEN ARRAY['resources.dispatches', 'resources.schedules', 'resources.failureModes', 'resources.locations', 'resources.processes', 'resources.workCenters', 'resources.abilities', 'resources.training', 'resources.assignments', 'resources.suggestions']
    WHEN 'sales' THEN ARRAY['sales.customers', 'sales.portals', 'sales.rfqs', 'sales.quotes', 'sales.salesOrders', 'sales.returns', 'sales.serviceContracts', 'sales.projectContracts', 'sales.rentalAgreements', 'sales.priceLists', 'sales.pricingRules', 'sales.salesRules', 'sales.noQuoteReasons', 'sales.returnReasons', 'sales.statuses', 'sales.types']
    WHEN 'service' THEN ARRAY['service.jobs', 'service.schedule', 'service.customerAssets']
    WHEN 'settings' THEN ARRAY['settings.company', 'settings.billing', 'settings.companies', 'settings.documentTemplates', 'settings.logos', 'settings.printing', 'settings.accounting', 'settings.inventory', 'settings.invoicing', 'settings.items', 'settings.people', 'settings.planning', 'settings.purchasing', 'settings.production', 'settings.projects', 'settings.time', 'settings.service', 'settings.quality', 'settings.sales', 'settings.resources', 'settings.apiKeys', 'settings.approvalRules', 'settings.auditLogs', 'settings.backups', 'settings.customFields', 'settings.demoData', 'settings.integrations', 'settings.itarCertifications', 'settings.security', 'settings.sequences', 'settings.serialNumbers', 'settings.webhooks']
    WHEN 'users' THEN ARRAY['users.accounts', 'users.operators', 'users.groups', 'users.employeeTypes']
    WHEN 'workflows' THEN ARRAY['workflows.workflows', 'workflows.runs']
    ELSE '{}'::text[]
  END
$function$;
