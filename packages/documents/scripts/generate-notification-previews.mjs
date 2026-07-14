// Regenerates the per-event NotificationEmail preview fixtures in
// src/email/previews/. The fixtures mirror what the notify function's
// content builder (packages/jobs/.../notifications/content.ts) produces per
// event — when that changes, update the entries here and re-run:
//   node ./scripts/generate-notification-previews.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/email/previews"
);
mkdirSync(OUT, { recursive: true });

const ASSIGNED_BY = { label: "Assigned by", value: "Tom Sawyer" };

// One entry per NotificationEvent. `heading`/`ctaLabel` mirror
// getNotificationEmailHeading / getNotificationEmailCtaLabel; `message` mirrors
// the `description` from getNotificationContent; `reference` + `details` mirror
// what that function builds per event (Assigned by is appended for *-assignment).
const previews = [
  {
    name: "QuoteAssignment",
    heading: "Quote assigned to you",
    message: "Quote Q-00012 assigned to you",
    reference: "Q-00012",
    cta: "View details",
    url: "https://app.carbon.ms/x/quote/1",
    details: [
      { label: "Customer", value: "Acme Corporation" },
      { label: "Customer ref", value: "PO-88921" },
      { label: "Expires", value: "Aug 14, 2026" },
      { label: "Status", value: "Sent" },
      ASSIGNED_BY
    ]
  },
  {
    name: "QuoteExpired",
    heading: "Quote expired",
    message: "Quote Q-00012 has expired",
    reference: "Q-00012",
    cta: "View quote",
    url: "https://app.carbon.ms/x/quote/1",
    details: [
      { label: "Customer", value: "Acme Corporation" },
      { label: "Customer ref", value: "PO-88921" },
      { label: "Expired", value: "Jun 30, 2026" }
    ]
  },
  {
    name: "DigitalQuoteResponse",
    heading: "Digital quote response",
    message: "Digital Quote Q-00012 was completed by buyer@acme.com",
    reference: "Q-00012",
    cta: "View response",
    url: "https://app.carbon.ms/x/quote/1",
    details: [
      { label: "Response", value: "Completed by buyer@acme.com" },
      { label: "Customer", value: "Acme Corporation" },
      { label: "Customer ref", value: "PO-88921" },
      { label: "Expires", value: "Aug 14, 2026" },
      { label: "Status", value: "Ordered" }
    ]
  },
  {
    name: "SalesOrderAssignment",
    heading: "Sales order assigned to you",
    message: "Sales Order SO-00045 assigned to you",
    reference: "SO-00045",
    cta: "View details",
    url: "https://app.carbon.ms/x/sales-order/1",
    details: [
      { label: "Customer", value: "Acme Corporation" },
      { label: "Customer ref", value: "PO-88921" },
      { label: "Order date", value: "Jul 1, 2026" },
      { label: "Status", value: "Confirmed" },
      ASSIGNED_BY
    ]
  },
  {
    name: "SalesRfqAssignment",
    heading: "RFQ assigned to you",
    message: "RFQ RFQ-0007 assigned to you",
    reference: "RFQ-0007",
    cta: "View details",
    url: "https://app.carbon.ms/x/sales-rfq/1",
    details: [
      { label: "Customer", value: "Acme Corporation" },
      { label: "Customer ref", value: "PO-88921" },
      { label: "Expires", value: "Aug 14, 2026" },
      { label: "Status", value: "Ready for Quote" },
      ASSIGNED_BY
    ]
  },
  {
    name: "SalesRfqReady",
    heading: "RFQ ready for quote",
    message: "RFQ RFQ-0007 is ready for quote",
    reference: "RFQ-0007",
    cta: "View details",
    url: "https://app.carbon.ms/x/sales-rfq/1",
    details: [
      { label: "Customer", value: "Acme Corporation" },
      { label: "Customer ref", value: "PO-88921" },
      { label: "Expires", value: "Aug 14, 2026" }
    ]
  },
  {
    name: "JobAssignment",
    heading: "Job assigned to you",
    message: "Job J00105 assigned to you",
    reference: "J00105",
    cta: "View details",
    url: "https://app.carbon.ms/x/job/1",
    details: [
      { label: "Part", value: "PART-1024" },
      { label: "Quantity", value: "25" },
      { label: "Due", value: "Jul 10, 2026" },
      { label: "Customer", value: "Acme Corporation" },
      ASSIGNED_BY
    ]
  },
  {
    name: "JobCompleted",
    heading: "Job completed",
    message: "Job J00105 is complete!",
    reference: "J00105",
    cta: "View job",
    url: "https://app.carbon.ms/x/job/1",
    details: [
      { label: "Part", value: "PART-1024" },
      { label: "Completed", value: "25" },
      { label: "Customer", value: "Acme Corporation" }
    ]
  },
  {
    name: "JobOperationAssignment",
    heading: "Job operation assigned to you",
    message: "New job operation assigned to you on J00105",
    reference: "J00105",
    cta: "View details",
    url: "https://app.carbon.ms/x/job/1",
    details: [
      { label: "Work center", value: "CNC Mill 1" },
      { label: "Due", value: "Jul 8, 2026" },
      { label: "Status", value: "Ready" },
      ASSIGNED_BY
    ]
  },
  {
    name: "JobOperationMessage",
    heading: "New job operation message",
    message: "New message on J00105 operation: Deburr all edges",
    reference: "J00105",
    cta: "View details",
    url: "https://app.carbon.ms/x/job/1",
    details: [
      { label: "Message", value: "Deburr all edges" },
      { label: "Work center", value: "CNC Mill 1" },
      { label: "Due", value: "Jul 8, 2026" },
      { label: "Status", value: "In Progress" }
    ]
  },
  {
    name: "MaintenanceDispatchAssignment",
    heading: "Maintenance dispatch assigned to you",
    message: "Maintenance dispatch MD-0012 for CNC Mill 1 assigned to you",
    reference: "MD-0012",
    cta: "View details",
    url: "https://app.carbon.ms/x/maintenance/1",
    details: [
      { label: "Priority", value: "High" },
      { label: "Severity", value: "Support Required" },
      { label: "Status", value: "Open" },
      ASSIGNED_BY
    ]
  },
  {
    name: "MaintenanceDispatchCreated",
    heading: "New maintenance dispatch",
    message: "New maintenance dispatch MD-0012 created",
    reference: "MD-0012",
    cta: "View details",
    url: "https://app.carbon.ms/x/maintenance/1",
    details: [
      { label: "Work center", value: "CNC Mill 1" },
      { label: "Priority", value: "High" },
      { label: "Severity", value: "Support Required" },
      { label: "Status", value: "Open" },
      { label: "Created by", value: "Tom Sawyer" }
    ]
  },
  {
    name: "NonConformanceAssignment",
    heading: "Issue assigned to you",
    message: "Issue NCR-0003 assigned to you",
    reference: "NCR-0003",
    cta: "View details",
    url: "https://app.carbon.ms/x/issue/1",
    details: [
      { label: "Priority", value: "High" },
      { label: "Status", value: "In Progress" },
      { label: "Due", value: "Jul 5, 2026" },
      { label: "Location", value: "Main Plant" },
      ASSIGNED_BY
    ]
  },
  {
    name: "RiskAssignment",
    heading: "Risk assigned to you",
    message: 'Risk "Single-source supplier" assigned to you',
    reference: "Single-source supplier",
    cta: "View details",
    url: "https://app.carbon.ms/x/quality/risk/1",
    details: [
      { label: "Type", value: "Risk" },
      { label: "Source", value: "Supplier" },
      { label: "Severity", value: "4 / 5" },
      { label: "Likelihood", value: "3 / 5" },
      { label: "Status", value: "Open" },
      ASSIGNED_BY
    ]
  },
  {
    name: "ProcedureAssignment",
    heading: "Procedure assigned to you",
    message: "Procedure Calibration SOP version 3 assigned to you",
    reference: "Calibration SOP",
    cta: "View details",
    url: "https://app.carbon.ms/x/procedure/1",
    details: [
      { label: "Version", value: "v3" },
      { label: "Status", value: "Active" },
      { label: "Process", value: "Final Inspection" },
      ASSIGNED_BY
    ]
  },
  {
    name: "GaugeCalibrationExpired",
    heading: "Gauge calibration expired",
    message: "Gauge GAUGE-14 is out of calibration",
    reference: "GAUGE-14",
    cta: "View gauge",
    url: "https://app.carbon.ms/x/gauge/1",
    details: [
      { label: "Description", value: "Digital caliper 0-150mm" },
      { label: "Last calibrated", value: "Jan 5, 2026" },
      { label: "Due", value: "Jun 30, 2026" },
      { label: "Status", value: "Out-of-Calibration" }
    ]
  },
  {
    name: "StockTransferAssignment",
    heading: "Stock transfer assigned to you",
    message: "Stock Transfer ST-0021 assigned to you",
    reference: "ST-0021",
    cta: "View details",
    url: "https://app.carbon.ms/x/stock-transfer/1",
    details: [
      { label: "Location", value: "Main Plant" },
      { label: "Items", value: "6" },
      { label: "Status", value: "Draft" },
      ASSIGNED_BY
    ]
  },
  {
    name: "PickingListAssignment",
    heading: "Picking list assigned to you",
    message: "Picking List PL-0008 assigned to you",
    reference: "PL-0008",
    cta: "View details",
    url: "https://app.carbon.ms/x/picking-list/1",
    details: [
      { label: "Location", value: "Main Plant" },
      { label: "Due", value: "Jul 3, 2026" },
      { label: "Status", value: "Draft" },
      ASSIGNED_BY
    ]
  },
  {
    name: "TrainingAssignment",
    heading: "Training assigned to you",
    message: 'Training "Anti-Bribery" assigned to you',
    reference: "Anti-Bribery",
    cta: "View details",
    url: "https://app.carbon.ms/x/training/1",
    details: [
      { label: "Type", value: "Mandatory" },
      { label: "Frequency", value: "Annual" },
      { label: "Duration", value: "30 minutes" },
      ASSIGNED_BY
    ]
  },
  {
    name: "ResourceTrainingAssignment",
    heading: "New training available",
    message: 'New training available: "Anti-Bribery"',
    reference: "Anti-Bribery",
    cta: "View details",
    url: "https://app.carbon.ms/x/training/1",
    details: [
      { label: "Type", value: "Mandatory" },
      { label: "Status", value: "Active" },
      { label: "Version", value: "v1" },
      ASSIGNED_BY
    ]
  },
  {
    name: "PurchaseOrderAssignment",
    heading: "Purchase order assigned to you",
    message: "Purchase Order PO-00099 assigned to you",
    reference: "PO-00099",
    cta: "View details",
    url: "https://app.carbon.ms/x/purchase-order/1",
    details: [
      { label: "Supplier", value: "Globex Inc." },
      { label: "Supplier ref", value: "SREF-55" },
      { label: "Order date", value: "Jul 1, 2026" },
      { label: "Status", value: "To Receive" },
      ASSIGNED_BY
    ]
  },
  {
    name: "PurchaseInvoiceAssignment",
    heading: "Purchase invoice assigned to you",
    message: "Purchase Invoice PINV-0031 assigned to you",
    reference: "PINV-0031",
    cta: "View details",
    url: "https://app.carbon.ms/x/purchase-invoice/1",
    details: [
      { label: "Supplier", value: "Globex Inc." },
      { label: "Amount", value: "$12,500.00" },
      { label: "Status", value: "Draft" },
      ASSIGNED_BY
    ]
  },
  {
    name: "SupplierQuoteAssignment",
    heading: "Supplier quote assigned to you",
    message: "Supplier Quote SQ-0014 assigned to you",
    reference: "SQ-0014",
    cta: "View details",
    url: "https://app.carbon.ms/x/supplier-quote/1",
    details: [
      { label: "Supplier", value: "Globex Inc." },
      { label: "Expires", value: "Aug 1, 2026" },
      { label: "Status", value: "Active" },
      ASSIGNED_BY
    ]
  },
  {
    name: "SupplierQuoteResponse",
    heading: "Supplier quote response",
    message: "Supplier Quote SQ-0014 was submitted by Globex Inc.",
    reference: "SQ-0014",
    cta: "View response",
    url: "https://app.carbon.ms/x/supplier-quote/1",
    details: [
      { label: "Submitted by", value: "Globex Inc." },
      { label: "Supplier", value: "Globex Inc." },
      { label: "Supplier ref", value: "SQ-GLX-2291" },
      { label: "Expires", value: "Aug 1, 2026" }
    ]
  },
  {
    name: "SuggestionResponse",
    heading: "New suggestion submitted",
    message: "New suggestion submitted by Jane Doe",
    reference: null,
    cta: "View suggestion",
    url: "https://app.carbon.ms/x/suggestions",
    details: [
      {
        label: "Suggestion",
        value: "Add a keyboard shortcut to duplicate a job"
      },
      { label: "Page", value: "/x/job/J00105" }
    ]
  },
  {
    name: "ApprovalRequested",
    heading: "Approval requested",
    message: "Purchase order PO-00099 requires your approval",
    reference: "PO-00099",
    cta: "Review approval",
    url: "https://app.carbon.ms/x/purchase-order/1",
    details: [
      { label: "Supplier", value: "Globex Inc." },
      { label: "Supplier ref", value: "SREF-55" },
      { label: "Status", value: "Needs Approval" },
      { label: "Requested by", value: "Tom Sawyer" }
    ]
  },
  {
    name: "ApprovalApproved",
    heading: "Your request was approved",
    message: "Purchase order PO-00099 was approved",
    reference: "PO-00099",
    cta: "View decision",
    url: "https://app.carbon.ms/x/purchase-order/1",
    details: [
      { label: "Supplier", value: "Globex Inc." },
      { label: "Supplier ref", value: "SREF-55" },
      { label: "Status", value: "To Receive" },
      { label: "Approved by", value: "Tom Sawyer" }
    ]
  },
  {
    name: "ApprovalRejected",
    heading: "Your request was rejected",
    message: "Purchase order PO-00099 was rejected",
    reference: "PO-00099",
    cta: "View decision",
    url: "https://app.carbon.ms/x/purchase-order/1",
    details: [
      { label: "Supplier", value: "Globex Inc." },
      { label: "Supplier ref", value: "SREF-55" },
      { label: "Status", value: "Rejected" },
      { label: "Rejected by", value: "Tom Sawyer" }
    ]
  }
];

const j = (v) => JSON.stringify(v);

for (const p of previews) {
  // Always emit `details` (even []), otherwise the component falls back to its
  // sample-default rows and empty-detail events (approvals, gauge) show bogus
  // Customer/Status/Assigned-by rows.
  const detailsProp = `\n      details={${JSON.stringify(p.details, null, 6).replace(/\n/g, "\n      ")}}`;
  // Emit string props as JSX expression containers ({"..."}) so values that
  // themselves contain double quotes (e.g. Training "Anti-Bribery") stay valid.
  const referenceProp = p.reference
    ? `\n      reference={${j(p.reference)}}`
    : "";
  const file = `import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// ${p.name} event. Not shipped (not exported from index.ts).
export default function ${p.name}Preview() {
  return (
    <NotificationEmail
      heading={${j(p.heading)}}
      preview={${j(p.heading)}}
      message={${j(p.message)}}${referenceProp}
      recipientName={"Naveen"}
      ctaLabel={${j(p.cta)}}
      ctaUrl={${j(p.url)}}${detailsProp}
    />
  );
}
`;
  writeFileSync(`${OUT}/${p.name}.tsx`, file);
}

console.log(`Wrote ${previews.length} preview files to ${OUT}`);
