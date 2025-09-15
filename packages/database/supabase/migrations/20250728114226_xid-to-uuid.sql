-- Function to convert UUID to base58 encoded string
CREATE OR REPLACE FUNCTION uuid_to_base58(_uuid UUID)
    RETURNS TEXT
    LANGUAGE plpgsql
AS
$$
DECLARE
    _alphabet TEXT := '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    _bytes BYTEA;
    _num NUMERIC := 0;
    _result TEXT := '';
    _remainder INT;
    _i INT;
BEGIN
    -- Convert UUID to bytes
    _bytes := decode(replace(_uuid::TEXT, '-', ''), 'hex');
    
    -- Convert bytes to big integer
    FOR _i IN 0..15 LOOP
        _num := _num * 256 + get_byte(_bytes, _i);
    END LOOP;
    
    -- Handle zero case
    IF _num = 0 THEN
        RETURN substring(_alphabet, 1, 1);
    END IF;
    
    -- Convert to base58
    WHILE _num > 0 LOOP
        _remainder := (_num % 58)::INT;
        _result := substring(_alphabet, _remainder + 1, 1) || _result;
        _num := floor(_num / 58);
    END LOOP;
    
    RETURN _result;
END;
$$;


CREATE OR REPLACE FUNCTION id(_prefix TEXT DEFAULT NULL)
    RETURNS TEXT
    LANGUAGE plpgsql
AS
$$
DECLARE
    _uuid TEXT;
BEGIN
    -- Generate UUID v4 and remove hyphens
    _uuid := REPLACE(uuid_to_base58(uuid_generate_v4()), '-', '');
    
    -- If prefix is provided, prepend it with underscore
    IF _prefix IS NOT NULL THEN
        RETURN _prefix || '_' || _uuid;
    ELSE
        RETURN _uuid;
    END IF;
END;
$$;


-- Core system tables
ALTER TABLE "company" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "company" ALTER COLUMN "id" SET DEFAULT id();


ALTER TABLE "location" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "location" ALTER COLUMN "id" SET DEFAULT id('loc');

-- Contact and address tables
ALTER TABLE "contact" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "contact" ALTER COLUMN "id" SET DEFAULT id('con');

ALTER TABLE "address" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "address" ALTER COLUMN "id" SET DEFAULT id('addr');

-- Customer tables
ALTER TABLE "customer" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "customer" ALTER COLUMN "id" SET DEFAULT id('cust');

ALTER TABLE "customerContact" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "customerContact" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "customerLocation" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "customerLocation" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "customerStatus" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "customerStatus" ALTER COLUMN "id" SET DEFAULT id('cs');

ALTER TABLE "customerPartToItem" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "customerPartToItem" ALTER COLUMN "id" SET DEFAULT id('cp');

-- Supplier tables
ALTER TABLE "supplier" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "supplier" ALTER COLUMN "id" SET DEFAULT id('sup');

ALTER TABLE "supplierContact" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "supplierContact" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "supplierLocation" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "supplierLocation" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "supplierStatus" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "supplierStatus" ALTER COLUMN "id" SET DEFAULT id('ss');

ALTER TABLE "supplierProcess" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "supplierProcess" ALTER COLUMN "id" SET DEFAULT id('sp');

ALTER TABLE "supplierQuote" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "supplierQuote" ALTER COLUMN "id" SET DEFAULT id('sq');

ALTER TABLE "supplierQuoteLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "supplierQuoteLine" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "supplierInteraction" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "supplierInteraction" ALTER COLUMN "id" SET DEFAULT id('si');

-- Item and inventory tables
ALTER TABLE "item" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "item" ALTER COLUMN "id" SET DEFAULT id('item');



ALTER TABLE "itemPostingGroup" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "itemPostingGroup" ALTER COLUMN "id" SET DEFAULT id('ipg');

ALTER TABLE "unitOfMeasure" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "unitOfMeasure" ALTER COLUMN "id" SET DEFAULT id('uom');

ALTER TABLE "warehouse" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "warehouse" ALTER COLUMN "id" SET DEFAULT id('wh');

ALTER TABLE "shelf" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "shelf" ALTER COLUMN "id" SET DEFAULT id('sh');

-- Parts and materials
ALTER TABLE "part" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "part" ALTER COLUMN "id" SET DEFAULT id('part');

ALTER TABLE "material" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "material" ALTER COLUMN "id" SET DEFAULT id('mat');

ALTER TABLE "materialForm" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "materialForm" ALTER COLUMN "id" SET DEFAULT id('shape');

ALTER TABLE "materialSubstance" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "materialSubstance" ALTER COLUMN "id" SET DEFAULT id('sub');

ALTER TABLE "materialFinish" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "materialFinish" ALTER COLUMN "id" SET DEFAULT id('finish');

ALTER TABLE "materialGrade" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "materialGrade" ALTER COLUMN "id" SET DEFAULT id('grade');

ALTER TABLE "materialType" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "materialType" ALTER COLUMN "id" SET DEFAULT id('mtype');

ALTER TABLE "materialDimension" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "materialDimension" ALTER COLUMN "id" SET DEFAULT id('mdim');


-- Sales tables
ALTER TABLE "salesOrder" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "salesOrder" ALTER COLUMN "id" SET DEFAULT id('so');

ALTER TABLE "salesOrderLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "salesOrderLine" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "salesOrderStatusHistory" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "salesOrderStatusHistory" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "salesOrderTransaction" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "salesOrderTransaction" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "salesRfq" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "salesRfq" ALTER COLUMN "id" SET DEFAULT id('srfq');

ALTER TABLE "salesRfqLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "salesRfqLine" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "salesInvoice" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "salesInvoice" ALTER COLUMN "id" SET DEFAULT id('si');

ALTER TABLE "salesInvoiceLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "salesInvoiceLine" ALTER COLUMN "id" SET DEFAULT id();

-- Purchase tables
ALTER TABLE "purchaseOrder" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "purchaseOrder" ALTER COLUMN "id" SET DEFAULT id('po');

ALTER TABLE "purchaseOrderLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "purchaseOrderLine" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "purchaseOrderStatusHistory" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "purchaseOrderStatusHistory" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "purchaseOrderTransaction" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "purchaseOrderTransaction" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "purchaseInvoice" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "purchaseInvoice" ALTER COLUMN "id" SET DEFAULT id('pi');

ALTER TABLE "purchaseInvoiceLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "purchaseInvoiceLine" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "purchaseInvoiceStatusHistory" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "purchaseInvoiceStatusHistory" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "purchaseInvoicePriceChange" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "purchaseInvoicePriceChange" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "purchasePayment" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "purchasePayment" ALTER COLUMN "id" SET DEFAULT id('ppay');

ALTER TABLE "purchaseInvoicePaymentRelation" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "purchaseInvoicePaymentRelation" ALTER COLUMN "id" SET DEFAULT id('pipr');

ALTER TABLE "paymentTerm" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "paymentTerm" ALTER COLUMN "id" SET DEFAULT id('pterm');

-- Quote tables
ALTER TABLE "quote" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "quote" ALTER COLUMN "id" SET DEFAULT id('quote');

ALTER TABLE "quoteLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "quoteLine" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "quoteMaterial" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "quoteMaterial" ALTER COLUMN "id" SET DEFAULT id('qmat');

ALTER TABLE "quoteMakeMethod" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "quoteMakeMethod" ALTER COLUMN "id" SET DEFAULT id('qmm');

ALTER TABLE "quoteOperation" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "quoteOperation" ALTER COLUMN "id" SET DEFAULT id('qo');

ALTER TABLE "quoteOperationTool" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "quoteOperationTool" ALTER COLUMN "id" SET DEFAULT id('qot');

ALTER TABLE "quoteOperationAttribute" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "quoteOperationAttribute" ALTER COLUMN "id" SET DEFAULT id('qoa');

ALTER TABLE "quoteOperationParameter" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "quoteOperationParameter" ALTER COLUMN "id" SET DEFAULT id('qop');

-- Manufacturing tables
ALTER TABLE "job" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "job" ALTER COLUMN "id" SET DEFAULT id('job');

ALTER TABLE "jobMaterial" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "jobMaterial" ALTER COLUMN "id" SET DEFAULT id('jmat');

ALTER TABLE "jobOperation" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "jobOperation" ALTER COLUMN "id" SET DEFAULT id('jo');

ALTER TABLE "jobMakeMethod" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "jobMakeMethod" ALTER COLUMN "id" SET DEFAULT id('jmm');

ALTER TABLE "jobOperationNote" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "jobOperationNote" ALTER COLUMN "id" SET DEFAULT id('jnote');

ALTER TABLE "jobOperationTool" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "jobOperationTool" ALTER COLUMN "id" SET DEFAULT id('jot');

ALTER TABLE "jobOperationAttribute" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "jobOperationAttribute" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "jobOperationParameter" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "jobOperationParameter" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "makeMethod" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "makeMethod" ALTER COLUMN "id" SET DEFAULT id('make');

ALTER TABLE "methodOperation" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "methodOperation" ALTER COLUMN "id" SET DEFAULT id('mop');

ALTER TABLE "methodMaterial" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "methodMaterial" ALTER COLUMN "id" SET DEFAULT id('mmat');

ALTER TABLE "methodOperationTool" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "methodOperationTool" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "methodOperationAttribute" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "methodOperationAttribute" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "methodOperationParameter" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "methodOperationParameter" ALTER COLUMN "id" SET DEFAULT id();

-- Production tables
ALTER TABLE "productionEvent" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "productionEvent" ALTER COLUMN "id" SET DEFAULT id('pe');

ALTER TABLE "productionQuantity" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "productionQuantity" ALTER COLUMN "id" SET DEFAULT id('pq');

-- Work center and equipment tables
ALTER TABLE "workCenter" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "workCenter" ALTER COLUMN "id" SET DEFAULT id('wc');



ALTER TABLE "process" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "process" ALTER COLUMN "id" SET DEFAULT id('pr');

ALTER TABLE "department" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "department" ALTER COLUMN "id" SET DEFAULT id('dept');



-- Employee and HR tables
ALTER TABLE "employee" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "employee" ALTER COLUMN "id" SET DEFAULT id('emp');

ALTER TABLE "employeeShift" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "employeeShift" ALTER COLUMN "id" SET DEFAULT id('eshift');

ALTER TABLE "employeeAbility" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "employeeAbility" ALTER COLUMN "id" SET DEFAULT id('ea');

ALTER TABLE "shift" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "shift" ALTER COLUMN "id" SET DEFAULT id('shift');

ALTER TABLE "ability" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "ability" ALTER COLUMN "id" SET DEFAULT id('abil');

ALTER TABLE "holiday" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "holiday" ALTER COLUMN "id" SET DEFAULT id('hol');

-- Accounting tables
ALTER TABLE "account" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "account" ALTER COLUMN "id" SET DEFAULT id('acct');

ALTER TABLE "accountCategory" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "accountCategory" ALTER COLUMN "id" SET DEFAULT id('actc');

ALTER TABLE "accountSubcategory" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "accountSubcategory" ALTER COLUMN "id" SET DEFAULT id('acts');

ALTER TABLE "accountingPeriod" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "accountingPeriod" ALTER COLUMN "id" SET DEFAULT id('ap');

ALTER TABLE "currency" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "currency" ALTER COLUMN "id" SET DEFAULT id('curr');

ALTER TABLE "journalLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "journalLine" ALTER COLUMN "id" SET DEFAULT id('jl');

ALTER TABLE "costLedger" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "costLedger" ALTER COLUMN "id" SET DEFAULT id('cl');

ALTER TABLE "itemLedger" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "itemLedger" ALTER COLUMN "id" SET DEFAULT id('il');

ALTER TABLE "supplierLedger" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "supplierLedger" ALTER COLUMN "id" SET DEFAULT id('supl');

ALTER TABLE "postingGroupInventory" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "postingGroupInventory" ALTER COLUMN "id" SET DEFAULT id('pgi');

ALTER TABLE "postingGroupPurchasing" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "postingGroupPurchasing" ALTER COLUMN "id" SET DEFAULT id('pgp');

ALTER TABLE "postingGroupSales" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "postingGroupSales" ALTER COLUMN "id" SET DEFAULT id('pgs');

-- Receipt and shipping tables
ALTER TABLE "receipt" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "receipt" ALTER COLUMN "id" SET DEFAULT id('rec');

ALTER TABLE "receiptLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "receiptLine" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "shipment" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "shipment" ALTER COLUMN "id" SET DEFAULT id('sh');

ALTER TABLE "shipmentLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "shipmentLine" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "shippingMethod" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "shippingMethod" ALTER COLUMN "id" SET DEFAULT id('smeth');

ALTER TABLE "shippingTerm" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "shippingTerm" ALTER COLUMN "id" SET DEFAULT id('sterm');

-- Document tables
ALTER TABLE "document" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "document" ALTER COLUMN "id" SET DEFAULT id('doc');

ALTER TABLE "documentTransaction" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "documentTransaction" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "modelUpload" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "modelUpload" ALTER COLUMN "id" SET DEFAULT id('model');

-- Service tables
ALTER TABLE "service" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "service" ALTER COLUMN "id" SET DEFAULT id('svc');


-- Note and attribute tables
ALTER TABLE "note" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "note" ALTER COLUMN "id" SET DEFAULT id('n');

ALTER TABLE "userAttribute" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "userAttribute" ALTER COLUMN "id" SET DEFAULT id('uatr');

ALTER TABLE "userAttributeCategory" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "userAttributeCategory" ALTER COLUMN "id" SET DEFAULT id('uatc');

ALTER TABLE "userAttributeValue" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "userAttributeValue" ALTER COLUMN "id" SET DEFAULT id('uatv');

ALTER TABLE "customField" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "customField" ALTER COLUMN "id" SET DEFAULT id('cf');

-- API and OAuth tables
ALTER TABLE "apiKey" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "apiKey" ALTER COLUMN "id" SET DEFAULT id('api');

ALTER TABLE "oauthClient" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "oauthClient" ALTER COLUMN "id" SET DEFAULT id('ocli');

ALTER TABLE "oauthCode" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "oauthCode" ALTER COLUMN "id" SET DEFAULT id('ocod');

ALTER TABLE "oauthToken" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "oauthToken" ALTER COLUMN "id" SET DEFAULT id('otok');

-- Quality tables
ALTER TABLE "nonConformance" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformance" ALTER COLUMN "id" SET DEFAULT id('nc');

ALTER TABLE "nonConformanceType" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceType" ALTER COLUMN "id" SET DEFAULT id('nct');

ALTER TABLE "nonConformanceWorkflow" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceWorkflow" ALTER COLUMN "id" SET DEFAULT id('ncw');

ALTER TABLE "nonConformanceSupplier" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceSupplier" ALTER COLUMN "id" SET DEFAULT id('ncs');

ALTER TABLE "nonConformanceCustomer" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceCustomer" ALTER COLUMN "id" SET DEFAULT id('ncc');

ALTER TABLE "nonConformanceJobOperation" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceJobOperation" ALTER COLUMN "id" SET DEFAULT id('ncjo');

ALTER TABLE "nonConformancePurchaseOrderLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformancePurchaseOrderLine" ALTER COLUMN "id" SET DEFAULT id('ncpol');

ALTER TABLE "nonConformanceSalesOrderLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceSalesOrderLine" ALTER COLUMN "id" SET DEFAULT id('ncsol');

ALTER TABLE "nonConformanceReceiptLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceReceiptLine" ALTER COLUMN "id" SET DEFAULT id('ncrl');

ALTER TABLE "nonConformanceTrackedEntity" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceTrackedEntity" ALTER COLUMN "id" SET DEFAULT id('ncte');

ALTER TABLE "nonConformanceShipmentLine" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceShipmentLine" ALTER COLUMN "id" SET DEFAULT id('ncsl');

ALTER TABLE "nonConformanceInvestigationTask" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceInvestigationTask" ALTER COLUMN "id" SET DEFAULT id('ncit');

ALTER TABLE "nonConformanceActionTask" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceActionTask" ALTER COLUMN "id" SET DEFAULT id('ncat');

ALTER TABLE "nonConformanceApprovalTask" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceApprovalTask" ALTER COLUMN "id" SET DEFAULT id('ncat');

ALTER TABLE "nonConformanceReviewer" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "nonConformanceReviewer" ALTER COLUMN "id" SET DEFAULT id('ncr');

ALTER TABLE "gauge" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "gauge" ALTER COLUMN "id" SET DEFAULT id('g');

ALTER TABLE "gaugeType" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "gaugeType" ALTER COLUMN "id" SET DEFAULT id('gt');

ALTER TABLE "gaugeCalibrationRecord" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "gaugeCalibrationRecord" ALTER COLUMN "id" SET DEFAULT id('gcr');

ALTER TABLE "scrapReason" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "scrapReason" ALTER COLUMN "id" SET DEFAULT id('sr');

ALTER TABLE "noQuoteReason" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "noQuoteReason" ALTER COLUMN "id" SET DEFAULT id('nqr');

-- Billing and plan tables
ALTER TABLE "plan" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "plan" ALTER COLUMN "id" SET DEFAULT id('plan');

ALTER TABLE "companyPlan" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "companyPlan" ALTER COLUMN "id" SET DEFAULT id('cplan');

ALTER TABLE "companyUsage" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "companyUsage" ALTER COLUMN "id" SET DEFAULT id('cusage');

ALTER TABLE "batchProperty" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "batchProperty" ALTER COLUMN "id" SET DEFAULT id('bp');



-- Procedure tables
ALTER TABLE "procedure" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "procedure" ALTER COLUMN "id" SET DEFAULT id('pro');

ALTER TABLE "procedureStep" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "procedureStep" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "procedureParameter" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "procedureParameter" ALTER COLUMN "id" SET DEFAULT id();

-- Configuration tables
ALTER TABLE "configurationParameter" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "configurationParameter" ALTER COLUMN "id" SET DEFAULT id('cp');

ALTER TABLE "configurationParameterGroup" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "configurationParameterGroup" ALTER COLUMN "id" SET DEFAULT id('cpg');

-- System tables
ALTER TABLE "webhook" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "webhook" ALTER COLUMN "id" SET DEFAULT id('hook');

ALTER TABLE "tableView" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "tableView" ALTER COLUMN "id" SET DEFAULT id('view');


ALTER TABLE "invite" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "invite" ALTER COLUMN "id" SET DEFAULT id('inv');

ALTER TABLE "feedback" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "feedback" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "terms" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "terms" ALTER COLUMN "id" SET DEFAULT id();

ALTER TABLE "opportunity" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "opportunity" ALTER COLUMN "id" SET DEFAULT id('opp');

ALTER TABLE "fulfillment" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "fulfillment" ALTER COLUMN "id" SET DEFAULT id('ful');

ALTER TABLE "period" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "period" ALTER COLUMN "id" SET DEFAULT id('per');

ALTER TABLE "supplierPart" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "supplierPart" ALTER COLUMN "id" SET DEFAULT id('sp');

