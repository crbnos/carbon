import type { FirstArticleInspectionPDFProps } from "./FirstArticleInspectionPDF";

/** Sample data for previewing and testing the AS9102 FAIR. */
export const SAMPLE_FIRST_ARTICLE_INSPECTION: FirstArticleInspectionPDFProps = {
  approved: false,
  header: {
    partNumber: "BRK-2210",
    partName: "Actuator Bracket",
    serialNumber: "SN-000184",
    fairIdentifier: "INS000042",
    partRevision: "B",
    drawingNumber: "DWG-2210",
    drawingRevision: "B",
    additionalChanges: "ECO000017 Hole pattern update",
    manufacturingProcessReference: "J000213 / BRK-2210",
    organizationName: "Acme Manufacturing Co.",
    supplierCode: "ACME-01",
    purchaseOrderNumber: "PO-88421",
    type: "Assembly",
    scope: "Full",
    baseline: null,
    reason: "New Part",
    hasNonconformance: false,
    verifiedByName: "Jane Doe",
    verifiedByTitle: "Quality Inspector",
    verifiedDate: "Jun 5, 2026",
    approvedByName: null,
    approvedByTitle: null,
    approvedDate: null,
    customerApprovalName: null,
    customerApprovalDate: null,
    comments: null
  },
  index: [
    {
      partNumber: "BSH-0101",
      partName: "Flanged Bushing",
      partType: "COTS",
      fairIdentifier: null
    },
    {
      partNumber: "PLT-0450-A",
      partName: "Mounting Plate",
      partType: "Sub-assembly",
      fairIdentifier: "INS000031"
    }
  ],
  products: [
    {
      kind: "Material",
      name: "Aluminum 6061-T6 plate",
      specification: "AMS 4027",
      code: null,
      supplier: "Metals Supply Co.",
      customerApprovalVerification: "N/A",
      certificateNumber: "MC-55120",
      functionalTestProcedureNumber: null,
      acceptanceReportNumber: null,
      comments: null
    },
    {
      kind: "Special Process",
      name: "Anodize",
      specification: "MIL-A-8625 Type II",
      code: "Class 2",
      supplier: "Finishing Partners",
      customerApprovalVerification: "Yes",
      certificateNumber: "FP-3391",
      functionalTestProcedureNumber: null,
      acceptanceReportNumber: null,
      comments: null
    }
  ],
  characteristics: [
    {
      characteristicNumber: "1",
      referenceLocation: "A2",
      designator: "Key",
      requirement: "25.400 ±0.050 mm",
      results: "25.412",
      tooling: null,
      nonconformanceNumber: null,
      comments: null
    },
    {
      characteristicNumber: "2",
      referenceLocation: "B3",
      designator: null,
      requirement: "0 +0.25/-0 Ⓜ",
      results: "0.3 — Accept with MMC (bonus 0.1, allowable 0.35; size #4)",
      tooling: null,
      nonconformanceNumber: null,
      comments: null
    },
    {
      characteristicNumber: "3",
      referenceLocation: "C1",
      designator: null,
      requirement: "Break all sharp edges",
      results: "Accept — Applied",
      tooling: "Applied",
      nonconformanceNumber: null,
      comments: null
    }
  ]
};
