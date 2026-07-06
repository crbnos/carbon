/**
 * Shared seed data for company initialization
 * Used by both seed-dev.ts (Node.js) and seed-company edge function (Deno)
 *
 * This is the single source of truth for all seed data.
 */

export const dimensions = [
  { name: "Location", entityType: "Location" },
  { name: "Department", entityType: "Department" },
  { name: "Employee", entityType: "Employee" },
  { name: "Cost Center", entityType: "CostCenter" },
  { name: "Item Posting Group", entityType: "ItemPostingGroup" },
  { name: "Customer Type", entityType: "CustomerType" },
  { name: "Supplier Type", entityType: "SupplierType" },
  { name: "Work Center", entityType: "WorkCenter" },
  { name: "Process", entityType: "Process" },
  { name: "Asset Class", entityType: "FixedAssetClass" },
] as const;

export const supplierStatuses = [
  "Active",
  "Inactive",
  "Pending",
  "Rejected"
] as const;

export const customerStatuses = [
  "Active",
  "Inactive",
  "Lead",
  "On Hold",
  "Cancelled"
] as const;

export const scrapReasons = ["Defective", "Damaged", "Quality"] as const;

export const paymentTerms = [
  {
    name: "Net 15",
    daysDue: 15,
    calculationMethod: "Net",
    daysDiscount: 0,
    discountPercentage: 0,
    createdBy: "system"
  },
  {
    name: "Net 30",
    daysDue: 30,
    calculationMethod: "Net",
    daysDiscount: 0,
    discountPercentage: 0,
    createdBy: "system"
  },
  {
    name: "Net 60",
    daysDue: 60,
    calculationMethod: "Net",
    daysDiscount: 0,
    discountPercentage: 0,
    createdBy: "system"
  },
  {
    name: "1% 10 Net 30",
    daysDue: 30,
    calculationMethod: "Net",
    daysDiscount: 10,
    discountPercentage: 1,
    createdBy: "system"
  },
  {
    name: "2% 10 Net 30",
    daysDue: 30,
    calculationMethod: "Net",
    daysDiscount: 10,
    discountPercentage: 2,
    createdBy: "system"
  },
  {
    name: "COD",
    daysDue: 0,
    calculationMethod: "Net",
    daysDiscount: 0,
    discountPercentage: 0,
    createdBy: "system"
  },
  {
    name: "Prepaid/ Pro forma",
    daysDue: 0,
    calculationMethod: "Net",
    daysDiscount: 0,
    discountPercentage: 0,
    createdBy: "system"
  },
  {
    name: "Net EOM 10th",
    daysDue: 10,
    calculationMethod: "End of Month",
    daysDiscount: 0,
    discountPercentage: 0,
    createdBy: "system"
  }
] as const;

export const unitOfMeasures = [
  { name: "Each", code: "EA", createdBy: "system" },
  { name: "Case", code: "CS", createdBy: "system" },
  { name: "Pack", code: "PK", createdBy: "system" },
  { name: "Pallet", code: "PL", createdBy: "system" },
  { name: "Roll", code: "RL", createdBy: "system" },
  { name: "Box", code: "BX", createdBy: "system" },
  { name: "Bag", code: "BG", createdBy: "system" },
  { name: "Drum", code: "DR", createdBy: "system" },
  { name: "Gallon", code: "GL", createdBy: "system" },
  { name: "Liter", code: "LT", createdBy: "system" },
  { name: "Ounce", code: "OZ", createdBy: "system" },
  { name: "Pound", code: "LB", createdBy: "system" },
  { name: "Ton", code: "TN", createdBy: "system" },
  { name: "Yard", code: "YD", createdBy: "system" },
  { name: "Meter", code: "MT", createdBy: "system" },
  { name: "Inch", code: "INCH", createdBy: "system" },
  { name: "Foot", code: "FOOT", createdBy: "system" }
] as const;

export const gaugeTypes = [
  "Gauge Block",
  "Caliper - Inside",
  "Caliper - Outside",
  "Caliper - Depth",
  "Micrometer - Outside",
  "Micrometer - Inside",
  "Micrometer - Depth",
  "Dial Indicator",
  "Height Gauge",
  "Thread Gauge",
  "Pin Gauge",
  "Ring Gauge",
  "Plug Gauge",
  "Bore Gauge",
  "Feeler Gauge",
  "Surface Plate",
  "Go/No-Go Gauge",
  "Profile Gauge",
  "Coordinate Measuring Machine (CMM)",
  "Optical Comparator"
] as const;

export const failureModes = [
  "Bearing Failure",
  "Lubrication Failure",
  "Electrical Fault",
  "Leak",
  "Excessive Wear",
  "Misalignment",
  "Overheating",
  "Cracking/Fatigue",
  "Blockage",
  "Excessive Vibration"
] as const;

export const nonConformanceTypes = [
  { name: "Design Error", createdBy: "system" },
  { name: "Manufacturing Defect", createdBy: "system" },
  { name: "Process Deviation", createdBy: "system" },
  { name: "Material Issue", createdBy: "system" },
  { name: "Testing Failure", createdBy: "system" },
  { name: "Documentation Error", createdBy: "system" },
  { name: "Training Issue", createdBy: "system" },
  { name: "Equipment Malfunction", createdBy: "system" },
  { name: "Supplier Issue", createdBy: "system" },
  { name: "Customer Complaint", createdBy: "system" }
] as const;

export const nonConformanceRequiredActions = [
  { name: "Corrective Action", systemType: "Corrective" as const, createdBy: "system" },
  { name: "Preventive Action", systemType: "Preventive" as const, createdBy: "system" },
  { name: "Containment Action", systemType: "Containment" as const, createdBy: "system" },
  { name: "Verification", systemType: "Verification" as const, createdBy: "system" },
  { name: "Customer Communication", systemType: "Communication" as const, createdBy: "system" },
  { name: "Root Cause Analysis", createdBy: "system" },
  { name: "Inventory", createdBy: "system" },
  { name: "WIP", createdBy: "system" },
  { name: "Finished Goods", createdBy: "system" },
  { name: "Incoming Materials", createdBy: "system" },
  { name: "Process", createdBy: "system" },
  { name: "Documentation", createdBy: "system" }
] as const;

export const sequences = [
  {
    table: "journalEntry",
    name: "Journal Entry",
    prefix: "JE-%{yyyy}-%{mm}-",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "job",
    name: "Job",
    prefix: "J",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "gauge",
    name: "Gauge",
    prefix: "G",
    suffix: null,
    next: 0,
    size: 5,
    step: 1
  },
  {
    table: "inboundInspection",
    name: "Inbound Inspection",
    prefix: "II",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "maintenanceDispatch",
    name: "Maintenance Dispatch",
    prefix: "MAIN",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "nonConformance",
    name: "Issue",
    prefix: "NCR",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "purchaseOrder",
    name: "Purchase Order",
    prefix: "PO",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "purchaseInvoice",
    name: "Purchase Invoice",
    prefix: "AP",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "purchasingRfq",
    name: "Purchasing RFQ",
    prefix: "PRFQ",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "receipt",
    name: "Receipt",
    prefix: "RE",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "salesRfq",
    name: "RFQ (Sales)",
    prefix: "RFQ",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "salesOrder",
    name: "Sales Order",
    prefix: "SO",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "salesInvoice",
    name: "Sales Invoice",
    prefix: "AR",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "stockTransfer",
    name: "Stock Transfer",
    prefix: "ST",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "quote",
    name: "Quote",
    prefix: "Q",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "supplierQuote",
    name: "Supplier Quote",
    prefix: "SQ",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "shipment",
    name: "Shipment",
    prefix: "SHP",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "warehouseTransfer",
    name: "Warehouse Transfer",
    prefix: "WT",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "supplier",
    name: "Supplier",
    prefix: "SUP",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "customer",
    name: "Customer",
    prefix: "CUS",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  },
  {
    table: "fixedAsset",
    name: "Fixed Asset",
    prefix: "FA",
    suffix: null,
    next: 1,
    size: 6,
    step: 1
  },
  {
    table: "depreciationRun",
    name: "Depreciation Run",
    prefix: "DR",
    suffix: null,
    next: 1,
    size: 6,
    step: 1
  },
  {
    table: "pickingList",
    name: "Picking List",
    prefix: "PL",
    suffix: null,
    next: 0,
    size: 6,
    step: 1
  }
] as const;

// All 118 currencies from the original seed
export const currencies = [
  { code: "USD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "CAD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "EUR", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "AED", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "AFN", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "ALL", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "AMD", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "ARS", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "AUD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "AZN", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "BAM", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "BDT", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "BGN", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "BHD", exchangeRate: 1, decimalPlaces: 3, createdBy: "system" },
  { code: "BIF", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "BND", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "BOB", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "BRL", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "BWP", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "BYN", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "BZD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "CDF", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "CHF", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "CLP", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "CNY", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "COP", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "CRC", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "CVE", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "CZK", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "DJF", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "DKK", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "DOP", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "DZD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "EGP", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "ERN", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "ETB", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "GBP", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "GEL", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "GHS", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "GNF", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "GTQ", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "HKD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "HNL", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "HRK", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "HUF", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "IDR", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "ILS", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "INR", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "IQD", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "IRR", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "ISK", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "JMD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "JOD", exchangeRate: 1, decimalPlaces: 3, createdBy: "system" },
  { code: "JPY", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "KES", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "KHR", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "KMF", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "KRW", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "KWD", exchangeRate: 1, decimalPlaces: 3, createdBy: "system" },
  { code: "KZT", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "LBP", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "LKR", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "LTL", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "LVL", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "LYD", exchangeRate: 1, decimalPlaces: 3, createdBy: "system" },
  { code: "MAD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "MDL", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "MGA", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "MKD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "MMK", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "MOP", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "MUR", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "MXN", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "MYR", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "MZN", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "NAD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "NGN", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "NIO", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "NOK", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "NPR", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "NZD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "OMR", exchangeRate: 1, decimalPlaces: 3, createdBy: "system" },
  { code: "PAB", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "PEN", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "PHP", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "PKR", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "PLN", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "PYG", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "QAR", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "RON", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "RSD", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "RUB", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "RWF", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "SAR", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "SDG", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "SEK", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "SGD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "SOS", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "SYP", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "THB", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "TND", exchangeRate: 1, decimalPlaces: 3, createdBy: "system" },
  { code: "TOP", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "TRY", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "TTD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "TWD", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "TZS", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "UAH", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "UGX", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "UYU", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "UZS", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "VEF", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "VND", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "XAF", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "XOF", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "YER", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "ZAR", exchangeRate: 1, decimalPlaces: 2, createdBy: "system" },
  { code: "ZMK", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" },
  { code: "ZWL", exchangeRate: 1, decimalPlaces: 0, createdBy: "system" }
] as const;


// Chart of accounts - parent-child tree structure
// key/parentKey are used to resolve parentId at insert time (not stored in the database)
// Group accounts have number: null (they are organizational containers)
// Leaf accounts have 4-digit numbers following the standard COA structure:
//   1000-1999 Assets | 2000-2999 Liabilities | 3000-3999 Equity
//   4000-4999 Revenue | 5000-5999 COGS | 6000-6999 Operating Expenses | 7000-7999 Other Expenses
export const accounts = [
  // ═══════════════════════════════════════════════════════════
  // BALANCE SHEET
  // ═══════════════════════════════════════════════════════════
  { key: "balance-sheet", number: null, name: "Balance Sheet", isGroup: true, parentKey: null, accountType: null, incomeBalance: "Balance Sheet", class: null, consolidatedRate: "Current", isSystem: true, createdBy: "system" },

  // ─── 1000-1999: ASSETS ───
  { key: "assets", number: null, name: "Assets", isGroup: true, parentKey: "balance-sheet", accountType: "Other Current Asset", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },

  // Cash & Bank
  { key: "cash-and-bank", number: null, name: "Cash & Bank", isGroup: true, parentKey: "assets", accountType: "Bank", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1010", number: "1010", name: "Bank - Cash", isGroup: false, parentKey: "cash-and-bank", accountType: "Bank", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1020", number: "1020", name: "Bank - Local Currency", isGroup: false, parentKey: "cash-and-bank", accountType: "Bank", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1030", number: "1030", name: "Bank - Foreign Currency", isGroup: false, parentKey: "cash-and-bank", accountType: "Bank", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },

  // Receivables
  { key: "receivables", number: null, name: "Receivables", isGroup: true, parentKey: "assets", accountType: "Accounts Receivable", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1110", number: "1110", name: "Accounts Receivable", isGroup: false, parentKey: "receivables", accountType: "Accounts Receivable", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1130", number: "1130", name: "Inter-Company Receivables", isGroup: false, parentKey: "receivables", accountType: "Accounts Receivable", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },

  // Inventory
  { key: "inventory", number: null, name: "Inventory & Stock", isGroup: true, parentKey: "assets", accountType: "Inventory", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1210", number: "1210", name: "Inventory", isGroup: false, parentKey: "inventory", accountType: "Inventory", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1230", number: "1230", name: "Work In Progress (WIP)", isGroup: false, parentKey: "inventory", accountType: "Inventory", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1240", number: "1240", name: "Inventory Reserves / Allowances", isGroup: false, parentKey: "inventory", accountType: "Inventory", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },

  // Property, Plant & Equipment
  { key: "ppe", number: null, name: "Property, Plant & Equipment", isGroup: true, parentKey: "assets", accountType: "Fixed Asset", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1310", number: "1310", name: "Fixed Asset Acquisition Cost", isGroup: false, parentKey: "ppe", accountType: "Fixed Asset", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1320", number: "1320", name: "Fixed Asset Acquisition Cost on Disposal", isGroup: false, parentKey: "ppe", accountType: "Fixed Asset", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1330", number: "1330", name: "Accumulated Depreciation", isGroup: false, parentKey: "ppe", accountType: "Accumulated Depreciation", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1340", number: "1340", name: "Accumulated Depreciation on Disposal", isGroup: false, parentKey: "ppe", accountType: "Accumulated Depreciation", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1350", number: "1350", name: "Machinery & Equipment", isGroup: false, parentKey: "ppe", accountType: "Fixed Asset", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1360", number: "1360", name: "Buildings & Leasehold Improvements", isGroup: false, parentKey: "ppe", accountType: "Fixed Asset", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },

  // Other Assets
  { key: "other-assets", number: null, name: "Other Assets", isGroup: true, parentKey: "assets", accountType: "Other Asset", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1410", number: "1410", name: "Intangible Assets", isGroup: false, parentKey: "other-assets", accountType: "Other Asset", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1420", number: "1420", name: "Accumulated Amortization", isGroup: false, parentKey: "other-assets", accountType: "Other Asset", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1430", number: "1430", name: "Investments in Subsidiaries", isGroup: false, parentKey: "other-assets", accountType: "Investments", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },
  { key: "1440", number: "1440", name: "Deferred Tax Assets", isGroup: false, parentKey: "other-assets", accountType: "Other Asset", incomeBalance: "Balance Sheet", class: "Asset", consolidatedRate: "Current", createdBy: "system" },

  // ─── 2000-2999: LIABILITIES ───
  { key: "liabilities", number: null, name: "Liabilities", isGroup: true, parentKey: "balance-sheet", accountType: "Other Current Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },

  // Payables
  { key: "payables", number: null, name: "Payables", isGroup: true, parentKey: "liabilities", accountType: "Accounts Payable", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2010", number: "2010", name: "Accounts Payable", isGroup: false, parentKey: "payables", accountType: "Accounts Payable", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2020", number: "2020", name: "Inter-Company Payables", isGroup: false, parentKey: "payables", accountType: "Accounts Payable", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },

  // Current Liabilities
  { key: "current-liabilities", number: null, name: "Current Liabilities", isGroup: true, parentKey: "liabilities", accountType: "Other Current Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2110", number: "2110", name: "Customer Prepayments", isGroup: false, parentKey: "current-liabilities", accountType: "Other Current Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2125", number: "2125", name: "GR/IR Clearing", isGroup: false, parentKey: "current-liabilities", accountType: "Other Current Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2130", number: "2130", name: "Inventory Shipped Not Invoiced", isGroup: false, parentKey: "current-liabilities", accountType: "Other Current Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2140", number: "2140", name: "Accrued Expenses", isGroup: false, parentKey: "current-liabilities", accountType: "Other Current Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2150", number: "2150", name: "Accrued Wages & Salaries", isGroup: false, parentKey: "current-liabilities", accountType: "Other Current Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2160", number: "2160", name: "Deferred Revenue", isGroup: false, parentKey: "current-liabilities", accountType: "Other Current Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2170", number: "2170", name: "Short-Term Loans", isGroup: false, parentKey: "current-liabilities", accountType: "Other Current Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },

  // Tax Liabilities
  { key: "tax-liabilities", number: null, name: "Tax Liabilities", isGroup: true, parentKey: "liabilities", accountType: "Tax", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2210", number: "2210", name: "Sales Tax Payable", isGroup: false, parentKey: "tax-liabilities", accountType: "Tax", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2220", number: "2220", name: "Purchase Tax Payable", isGroup: false, parentKey: "tax-liabilities", accountType: "Tax", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2230", number: "2230", name: "Reverse Charge Tax Payable", isGroup: false, parentKey: "tax-liabilities", accountType: "Tax", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },

  // Long-Term Liabilities
  { key: "long-term-liabilities", number: null, name: "Long-Term Liabilities", isGroup: true, parentKey: "liabilities", accountType: "Long Term Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2410", number: "2410", name: "Long-Term Debt / Loans", isGroup: false, parentKey: "long-term-liabilities", accountType: "Long Term Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2420", number: "2420", name: "Deferred Tax Liabilities", isGroup: false, parentKey: "long-term-liabilities", accountType: "Long Term Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
  { key: "2430", number: "2430", name: "Pension Obligations", isGroup: false, parentKey: "long-term-liabilities", accountType: "Long Term Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },

  // ─── 3000-3999: EQUITY ───
  { key: "equity", number: null, name: "Equity", isGroup: true, parentKey: "balance-sheet", accountType: "Equity - No Close", incomeBalance: "Balance Sheet", class: "Equity", consolidatedRate: "Historical", createdBy: "system" },
  { key: "3010", number: "3010", name: "Common Stock / Share Capital", isGroup: false, parentKey: "equity", accountType: "Equity - No Close", incomeBalance: "Balance Sheet", class: "Equity", consolidatedRate: "Historical", createdBy: "system" },
  { key: "3100", number: "3100", name: "Retained Earnings", isGroup: false, parentKey: "equity", accountType: "Retained Earnings", incomeBalance: "Balance Sheet", class: "Equity", consolidatedRate: "Historical", createdBy: "system" },
  { key: "3200", number: "3200", name: "Reserves (Currency Translation)", isGroup: false, parentKey: "equity", accountType: "Equity - Close", incomeBalance: "Balance Sheet", class: "Equity", consolidatedRate: "Historical", createdBy: "system" },
  { key: "3300", number: "3300", name: "Dividends Payable", isGroup: false, parentKey: "equity", accountType: "Equity - Close", incomeBalance: "Balance Sheet", class: "Equity", consolidatedRate: "Historical", createdBy: "system" },

  // ═══════════════════════════════════════════════════════════
  // INCOME STATEMENT
  // ═══════════════════════════════════════════════════════════
  { key: "income-statement", number: null, name: "Income Statement", isGroup: true, parentKey: null, accountType: null, incomeBalance: "Income Statement", class: null, consolidatedRate: "Average", isSystem: true, createdBy: "system" },

  // ─── 4000-4999: REVENUE ───
  { key: "revenue", number: null, name: "Revenue", isGroup: true, parentKey: "income-statement", accountType: "Income", incomeBalance: "Income Statement", class: "Revenue", consolidatedRate: "Average", createdBy: "system" },
  { key: "4010", number: "4010", name: "Sales", isGroup: false, parentKey: "revenue", accountType: "Income", incomeBalance: "Income Statement", class: "Revenue", consolidatedRate: "Average", createdBy: "system" },
  { key: "4020", number: "4020", name: "Sales Discounts", isGroup: false, parentKey: "revenue", accountType: "Income", incomeBalance: "Income Statement", class: "Revenue", consolidatedRate: "Average", createdBy: "system" },
  { key: "4030", number: "4030", name: "Manufacturing Services Revenue", isGroup: false, parentKey: "revenue", accountType: "Income", incomeBalance: "Income Statement", class: "Revenue", consolidatedRate: "Average", createdBy: "system" },

  // Other Income
  { key: "other-income", number: null, name: "Other Income", isGroup: true, parentKey: "income-statement", accountType: "Other Income", incomeBalance: "Income Statement", class: "Revenue", consolidatedRate: "Average", createdBy: "system" },
  { key: "4110", number: "4110", name: "Scrap Sales", isGroup: false, parentKey: "other-income", accountType: "Other Income", incomeBalance: "Income Statement", class: "Revenue", consolidatedRate: "Average", createdBy: "system" },
  { key: "4120", number: "4120", name: "Foreign Exchange Gains", isGroup: false, parentKey: "other-income", accountType: "Other Income", incomeBalance: "Income Statement", class: "Revenue", consolidatedRate: "Average", createdBy: "system" },

  // ─── 5000-5999: COST OF GOODS SOLD ───
  { key: "cogs", number: null, name: "Cost of Goods Sold", isGroup: true, parentKey: "income-statement", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "5010", number: "5010", name: "Cost of Goods Sold - Direct", isGroup: false, parentKey: "cogs", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "5050", number: "5050", name: "Indirect Materials & Services", isGroup: false, parentKey: "cogs", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "5060", number: "5060", name: "Labor & Machine Absorption", isGroup: false, parentKey: "cogs", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },

  // Variances
  { key: "variances", number: null, name: "Variances", isGroup: true, parentKey: "cogs", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "5210", number: "5210", name: "Purchase Price Variance", isGroup: false, parentKey: "variances", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "5220", number: "5220", name: "Material Usage Variance", isGroup: false, parentKey: "variances", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "5230", number: "5230", name: "Labor & Machine Variance", isGroup: false, parentKey: "variances", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "5240", number: "5240", name: "Overhead Variance", isGroup: false, parentKey: "variances", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "5250", number: "5250", name: "Lot Size Variance", isGroup: false, parentKey: "variances", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "5260", number: "5260", name: "Subcontracting Variance", isGroup: false, parentKey: "variances", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },

  // Inventory Adjustments
  { key: "inventory-adjustments", number: null, name: "Inventory Adjustments", isGroup: true, parentKey: "cogs", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "5310", number: "5310", name: "Inventory Adjustment", isGroup: false, parentKey: "inventory-adjustments", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },

  // ─── 6000-6999: OPERATING EXPENSES ───
  { key: "operating-expenses", number: null, name: "Operating Expenses", isGroup: true, parentKey: "income-statement", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6010", number: "6010", name: "Maintenance Expense", isGroup: false, parentKey: "operating-expenses", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6020", number: "6020", name: "Sales Commissions", isGroup: false, parentKey: "operating-expenses", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6030", number: "6030", name: "Advertising & Marketing", isGroup: false, parentKey: "operating-expenses", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6040", number: "6040", name: "Freight & Shipping Out", isGroup: false, parentKey: "operating-expenses", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6050", number: "6050", name: "Bad Debts Expense", isGroup: false, parentKey: "operating-expenses", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6060", number: "6060", name: "Salaries - Administrative", isGroup: false, parentKey: "operating-expenses", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6070", number: "6070", name: "Rent & Utilities (Non-Factory)", isGroup: false, parentKey: "operating-expenses", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6080", number: "6080", name: "Professional Fees", isGroup: false, parentKey: "operating-expenses", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6090", number: "6090", name: "Travel & Entertainment", isGroup: false, parentKey: "operating-expenses", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6100", number: "6100", name: "Insurance", isGroup: false, parentKey: "operating-expenses", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6110", number: "6110", name: "Bank Charges & Fees", isGroup: false, parentKey: "operating-expenses", accountType: "Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },

  // Depreciation & Amortization
  { key: "depreciation", number: null, name: "Depreciation & Amortization", isGroup: true, parentKey: "operating-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6310", number: "6310", name: "Depreciation Expense", isGroup: false, parentKey: "depreciation", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "6320", number: "6320", name: "Gains and Losses on Disposal", isGroup: false, parentKey: "depreciation", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },

  // ─── 7000-7999: OTHER / NON-OPERATING EXPENSES ───
  { key: "other-expenses", number: null, name: "Other Expenses", isGroup: true, parentKey: "income-statement", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "7010", number: "7010", name: "Interest Expense", isGroup: false, parentKey: "other-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "7020", number: "7020", name: "Supplier Payment Discounts", isGroup: false, parentKey: "other-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "7030", number: "7030", name: "Customer Payment Discounts", isGroup: false, parentKey: "other-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "7040", number: "7040", name: "Service Charge Account", isGroup: false, parentKey: "other-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "7050", number: "7050", name: "Rounding Account", isGroup: false, parentKey: "other-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "7060", number: "7060", name: "Foreign Exchange Losses", isGroup: false, parentKey: "other-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "7070", number: "7070", name: "Income Tax Expense", isGroup: false, parentKey: "other-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "7080", number: "7080", name: "R&D Expenses", isGroup: false, parentKey: "other-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
  { key: "7090", number: "7090", name: "Deferred Tax Expense", isGroup: false, parentKey: "other-expenses", accountType: "Other Expense", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" },
] as const;

export const accountDefaults = {
  salesAccount: "4010",
  salesDiscountAccount: "4020",
  costOfGoodsSoldAccount: "5010",
  purchaseVarianceAccount: "5210",
  inventoryAdjustmentVarianceAccount: "5310",
  materialVarianceAccount: "5220",
  laborAndMachineVarianceAccount: "5230",
  overheadVarianceAccount: "5240",
  lotSizeVarianceAccount: "5250",
  subcontractingVarianceAccount: "5260",
  laborAbsorptionAccount: "5060",
  indirectCostAccount: "5050",
  maintenanceAccount: "6010",
  assetDepreciationExpenseAccount: "6310",
  assetGainsAndLossesAccount: "6320",
  serviceChargeAccount: "7040",
  interestAccount: "7010",
  supplierPaymentDiscountAccount: "7020",
  customerPaymentDiscountAccount: "7030",
  roundingAccount: "7050",
  assetAquisitionCostAccount: "1310",
  assetAquisitionCostOnDisposalAccount: "1320",
  accumulatedDepreciationAccount: "1330",
  accumulatedDepreciationOnDisposalAccount: "1340",
  inventoryAccount: "1210",
  workInProgressAccount: "1230",
  receivablesAccount: "1110",
  bankCashAccount: "1010",
  bankLocalCurrencyAccount: "1020",
  bankForeignCurrencyAccount: "1030",
  prepaymentAccount: "2110",
  payablesAccount: "2010",
  goodsReceivedNotInvoicedAccount: "2125",
  inventoryShippedNotInvoicedAccount: "2130",
  salesTaxPayableAccount: "2210",
  purchaseTaxPayableAccount: "2220",
  reverseChargeSalesTaxPayableAccount: "2230",
  retainedEarningsAccount: "3100",
  currencyTranslationAccount: "3200",
  deferredTaxLiabilityAccountId: "2420",
  deferredTaxExpenseAccountId: "7090",
} as const;

export const fixedAssetClasses = [
  {
    name: "Buildings",
    depreciationMethod: "Straight Line" as const,
    usefulLifeMonths: 468,
    residualValuePercent: 0,
    assetAccount: "1360",
    accumulatedDepreciationAccount: "1330",
    depreciationExpenseAccount: "6310",
    writeOffAccount: "6320",
    writeDownAccount: "6320",
    disposalAccount: "6320",
  },
  {
    name: "Machinery & Equipment",
    depreciationMethod: "Straight Line" as const,
    usefulLifeMonths: 120,
    residualValuePercent: 0,
    assetAccount: "1350",
    accumulatedDepreciationAccount: "1330",
    depreciationExpenseAccount: "6310",
    writeOffAccount: "6320",
    writeDownAccount: "6320",
    disposalAccount: "6320",
  },
  {
    name: "Vehicles",
    depreciationMethod: "Straight Line" as const,
    usefulLifeMonths: 60,
    residualValuePercent: 0,
    assetAccount: "1310",
    accumulatedDepreciationAccount: "1330",
    depreciationExpenseAccount: "6310",
    writeOffAccount: "6320",
    writeDownAccount: "6320",
    disposalAccount: "6320",
  },
];

export const fiscalYearSettings = {
  startMonth: "January",
  taxStartMonth: "January",
  updatedBy: "system"
} as const;

/**
 * Default location seeded for new companies
 * Required for inventory quantities, jobs, and other location-dependent features
 */
export const defaultLocation = {
  name: "Headquarters",
  addressLine1: "123 Main Street",
  city: "Austin",
  stateProvince: "TX",
  postalCode: "78701",
  countryCode: "US",
  timezone: "America/Chicago",
  createdBy: "system"
} as const;

export const groups = [
  {
    idPrefix: "00000000-0000",
    name: "All Employees",
    isCustomerTypeGroup: false,
    isEmployeeTypeGroup: true,
    isSupplierTypeGroup: false
  },
  {
    idPrefix: "11111111-1111",
    name: "All Customers",
    isCustomerTypeGroup: true,
    isEmployeeTypeGroup: false,
    isSupplierTypeGroup: false
  },
  {
    idPrefix: "22222222-2222",
    name: "All Suppliers",
    isCustomerTypeGroup: false,
    isEmployeeTypeGroup: false,
    isSupplierTypeGroup: true
  }
] as const;

/**
 * Helper to generate group ID from idPrefix and company ID
 * The resulting ID format: {idPrefix}-{companyId formatted as XXXX-YYYY-ZZZZZZZZZZZZ}
 */
export function getGroupId(idPrefix: string, companyId: string): string {
  const companyIdPart = `${companyId.substring(0, 4)}-${companyId.substring(
    4,
    8
  )}-${companyId.substring(8, 20)}`;
  return `${idPrefix}-${companyIdPart}`;
}
