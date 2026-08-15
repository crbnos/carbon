import {
  adaptCarbonOperationToFactoryObject,
  adaptErpJobToFactoryObject,
  type EvidenceRecord,
  type FactoryException
} from "@carbon/utils";

export const productionOrder = adaptErpJobToFactoryObject({
  recordId: "MO-0815-001",
  displayName: "Pump housing batch",
  status: "In Progress"
});

export const highRiskOperation = {
  ...adaptCarbonOperationToFactoryObject({
    recordId: "OP-30",
    displayName: "Finish machining",
    status: "In Progress",
    workCenterId: "CNC-2"
  }),
  risk: "high" as const
};

export const blockedEquipmentException: FactoryException = {
  id: "EX-OP-30",
  type: "equipment",
  severity: "critical",
  subject: { id: highRiskOperation.id, type: highRiskOperation.type },
  summary: "Operation is blocked",
  facts: [{ label: "Observed", value: "Machining stopped at OP-30." }],
  inferredCause: {
    label: "Likely cause",
    text: "Tool wear is the likely cause.",
    confidence: "medium"
  },
  impact: { summary: "Shipment may be delayed by one shift." },
  owner: { label: "Production supervisor" },
  evidenceRefs: ["evidence-op-30"],
  recommendations: [
    {
      id: "recommendation-tool-check",
      text: "Inspect the tool before rescheduling."
    }
  ],
  lifecycle: "open"
};

export const evidenceRecords: EvidenceRecord[] = [
  {
    id: "evidence-cycle-time",
    source: {
      system: "carbon-mes",
      objectType: "Operation",
      recordId: "OP-30"
    },
    subject: { id: highRiskOperation.id, type: highRiskOperation.type },
    fact: { label: "Cycle time", value: 42, unit: "minutes" },
    observedAt: "2026-08-15T10:30:00Z",
    freshness: "fresh",
    version: "Event 1842"
  },
  {
    id: "evidence-material-request",
    source: {
      system: "erpnext",
      objectType: "Material Request",
      recordId: "MR-088"
    },
    subject: { id: productionOrder.id, type: productionOrder.type },
    fact: { label: "Required quantity", value: 120, unit: "kg" },
    observedAt: "2026-08-14T16:10:00Z",
    freshness: "aging"
  },
  {
    id: "evidence-risk-assessment",
    source: {
      system: "factory-os",
      objectType: "Risk Assessment",
      recordId: "RA-17"
    },
    fact: { label: "Delivery risk", value: "High" },
    observedAt: "2026-08-10T08:00:00Z",
    freshness: "stale",
    provenance: { model: "Planning model v3" }
  },
  {
    id: "evidence-unknown-freshness",
    source: {
      system: "erpnext",
      objectType: "Purchase Order",
      recordId: "PO-812"
    },
    fact: { label: "Supplier confirmation", description: "Unavailable" },
    freshness: "fresh"
  }
];
