// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  GaugeSpec,
  InspectionFeatureSpec,
  InspectionSpec,
  NonConformanceSpec,
  NonConformanceWorkflowSpec,
  QualityData,
  QualityDocumentSpec,
  RiskSpec
} from "../../types.ts";

// The new-issue form copies source, required actions and MRB from these templates onto the issue.
export const WORKFLOWS: NonConformanceWorkflowSpec[] = [
  {
    key: "supplier-escape",
    name: "Supplier Escape — Flight Hardware",
    description:
      "A purchased flight part failed receiving inspection. Quarantine the lot, find the root cause with the supplier, and put their corrective action on record before MRB closes it out.",
    priority: "High",
    source: "External",
    requiredActions: [
      "Containment Action",
      "Root Cause Analysis",
      "Corrective Action"
    ],
    mrb: true
  },
  {
    key: "customer-return",
    name: "Customer Complaint — Returned Unit",
    description:
      "A customer reported a failure on delivered hardware. Acknowledge within one business day, contain any sister units, and verify the fix before closing.",
    priority: "Medium",
    source: "External",
    requiredActions: [
      "Customer Communication",
      "Containment Action",
      "Verification"
    ]
  },
  {
    key: "incoming-hold",
    name: "Incoming Lot Hold",
    description:
      "An incoming lot failed a screening test. Hold the whole lot in quarantine until teardown decides its disposition.",
    priority: "Medium",
    source: "Internal",
    requiredActions: ["Containment Action"]
  }
];

export const NON_CONFORMANCES: NonConformanceSpec[] = [
  {
    ref: "ncr:eps",
    name: "Power harness short detected at integration",
    source: "Internal",
    status: "In Progress",
    openDateOffset: -296,
    quantity: 1,
    priority: "High",
    // An issue raised on the floor is raised against the operation that produced
    // it. Without this link the issue page's Associations card is empty.
    jobOperation: { job: "job:in-progress" },
    items: [{ item: "ISR4-AV", quantity: 1 }],
    assignee: "self"
  },
  {
    ref: "ncr:fastener",
    name: "Hinge-block fastener torque below spec on arm station 3",
    source: "Internal",
    status: "Registered",
    openDateOffset: -285,
    quantity: 12,
    priority: "Medium",
    items: [{ item: "FST-M5-A286", quantity: 12 }]
  },
  {
    ref: "ncr:tank-wall",
    purchaseReturnLine: {
      purchaseReturn: "tank-wall-rtv",
      line: 1,
      quantity: 1
    },
    name: "Carbon arm wall below minimum thickness, delamination at mid-span",
    description:
      "Receiving UT scan on the Sentry short delivery measured 1.12 mm wall at mid-span of one ARM-CF-30 against a 1.15 mm minimum, with a 6 mm delamination. Arm quarantined; MRB to decide return-to-vendor vs. use-as-is with a strength analysis.",
    type: "Supplier Issue",
    source: "External",
    status: "In Progress",
    openDateOffset: -78,
    dueDateOffset: 14,
    quantity: 1,
    priority: "Critical",
    supplier: "Sentry Propulsion Systems",
    purchaseOrderLine: { po: "po:closed-short", item: "ARM-CF-30" },
    inspection: "insp:tank",
    items: [
      { item: "ARM-CF-30", quantity: 1, disposition: "Return to Supplier" },
      { item: "ARM-200", quantity: 1 }
    ],
    assignee: "self",
    workflow: "supplier-escape",
    actionTasks: [
      {
        action: "Containment Action",
        status: "Completed",
        dueDateOffset: -76,
        completedOffset: -77
      },
      {
        action: "Root Cause Analysis",
        status: "In Progress",
        dueDateOffset: 7,
        processes: ["UAS Integration"]
      },
      { action: "Corrective Action", status: "Pending", dueDateOffset: 21 }
    ],
    mrb: {
      status: "In Progress",
      dueDateOffset: 10,
      reviewers: [
        { title: "Engineering", status: "Completed", completedOffset: -70 },
        { title: "Quality", status: "In Progress" }
      ]
    }
  },
  {
    ref: "ncr:txrx-tvac",
    salesReturnLine: { salesReturn: "transponder", line: 1 },
    name: "Customer-reported mesh radio spare drifts off channel at cold soak",
    description:
      "Northgate reported one of two RDO-MESH-2X2 spares drifting 40 kHz off channel during their -32 °C cold-soak pre-screen. Unit returned for evaluation; root cause traced to an unstaked TCXO shield lid.",
    type: "Customer Complaint",
    source: "External",
    status: "Closed",
    openDateOffset: -12,
    dueDateOffset: 2,
    closeDateOffset: -3,
    quantity: 1,
    priority: "Low",
    customer: "Northgate Defense Systems",
    salesOrderLine: "soline:novasat-spares:txrx",
    items: [{ item: "RDO-MESH-2X2", quantity: 1, disposition: "Rework" }],
    workflow: "customer-return",
    actionTasks: [
      {
        action: "Customer Communication",
        status: "Completed",
        dueDateOffset: -11,
        completedOffset: -11
      },
      {
        action: "Containment Action",
        status: "Completed",
        dueDateOffset: -9,
        completedOffset: -10
      },
      {
        action: "Verification",
        status: "Completed",
        dueDateOffset: -4,
        completedOffset: -4
      }
    ]
  },
  {
    ref: "ncr:bat-lot",
    name: "Li-ion battery lot quarantined — capacity drift on incoming cycle test",
    description:
      "Lot LOT-BAT-2609 lost 3.8% capacity over the first 20 incoming cycles, outside the 2% screening limit. Lot placed on hold pending cell-level teardown.",
    type: "Material Issue",
    source: "Internal",
    status: "Registered",
    openDateOffset: -6,
    dueDateOffset: 20,
    quantity: 1,
    priority: "Medium",
    trackedEntity: "LOT-BAT-2609",
    items: [{ item: "BAT-SMART-11AH", quantity: 1 }],
    // Feeds the supplier-quality KPI's issue this month.
    supplier: "Vanguard Electronics Supply",
    workflow: "incoming-hold",
    actionTasks: [
      { action: "Containment Action", status: "Pending", dueDateOffset: 2 }
    ]
  }
];

// Lot of 2 at AQL 1.0 / level II → code letter A, n = 2.
const BARE_BOARD_PLAN = {
  drawingNumber: "PCB-BARE-R3 Fab Dwg Rev C",
  aql: 1.0,
  features: [
    {
      label: "1",
      description: "Board thickness over copper",
      nominalValue: "1.60",
      tolerancePlus: "0.16",
      toleranceMinus: "0.16",
      unit: "mm"
    },
    {
      label: "2",
      description: "Plated through-hole diameter, J1 connector pattern",
      nominalValue: "1.00",
      tolerancePlus: "0.05",
      toleranceMinus: "0.05",
      unit: "mm"
    }
  ] satisfies InspectionFeatureSpec[]
};

export const INSPECTIONS: InspectionSpec[] = [
  {
    source: "Receipt",
    ref: "insp:tank",
    receipt: "receipt:short",
    item: "ARM-CF-30",
    drawingNumber: "ARM-CF-30 Rev C",
    aql: 1.0,
    features: [
      {
        label: "1",
        description: "Hinge-pin bore diameter (reamed)",
        nominalValue: "0.4050",
        tolerancePlus: "0.0020",
        toleranceMinus: "0.0020",
        unit: "in"
      },
      {
        label: "2",
        description: "Wall thickness at mid-span (UT)",
        nominalValue: "1.20",
        tolerancePlus: "0.10",
        toleranceMinus: "0.05",
        unit: "mm"
      }
    ],
    status: "Partial",
    dispositionOffset: -78,
    notes:
      "S/N 0417 accepted. S/N 0418 wall under minimum at mid-span with a delamination — quarantined and raised to MRB.",
    samples: [
      {
        status: "Passed",
        inspectedOffset: -79,
        measurements: [
          { feature: "1", value: 0.4052 },
          { feature: "2", value: 1.22 }
        ]
      },
      {
        status: "Failed",
        inspectedOffset: -79,
        measurements: [
          { feature: "1", value: 0.4049 },
          { feature: "2", value: 1.12 }
        ]
      }
    ]
  },
  // 10 boards at AQL 1.0 → n = 3.
  {
    source: "Receipt",
    ref: "insp:bare-boards",
    receipt: "receipt:paid",
    item: "PCB-BARE-R3",
    ...BARE_BOARD_PLAN,
    status: "Passed",
    dispositionOffset: -67,
    notes: "Three boards measured; thickness and via sizes nominal.",
    samples: [
      {
        status: "Passed",
        inspectedOffset: -67,
        measurements: [
          { feature: "1", value: 1.62 },
          { feature: "2", value: 1.01 }
        ]
      },
      {
        status: "Passed",
        inspectedOffset: -67,
        measurements: [
          { feature: "1", value: 1.58 },
          { feature: "2", value: 0.99 }
        ]
      },
      {
        status: "Passed",
        inspectedOffset: -67,
        measurements: [
          { feature: "1", value: 1.61 },
          { feature: "2", value: 1.02 }
        ]
      }
    ]
  },
  {
    source: "Receipt",
    ref: "insp:bare-boards-queue",
    receipt: "receipt:bare-boards",
    item: "PCB-BARE-R3",
    ...BARE_BOARD_PLAN,
    status: "Pending",
    samples: []
  },
  {
    source: "Job Operation",
    ref: "insp:eps-fpt",
    job: "floor-eps-pcb",
    status: "In Progress",
    notes: "Board 1 of 4 measured; boards 2–4 still curing.",
    samples: [
      {
        status: "Passed",
        inspectedOffset: -1,
        measurements: [
          { feature: "1", value: 5.02 },
          { feature: "2", value: 2.05 }
        ]
      }
    ]
  }
];

export const QUALITY_DOCUMENTS: QualityDocumentSpec[] = [
  {
    name: "Flight Hardware Receiving Inspection",
    version: 1,
    status: "Archived",
    description:
      "Superseded receiving procedure for flight hardware — visual and certificate review only.",
    steps: []
  },
  {
    name: "Flight Hardware Receiving Inspection",
    version: 2,
    status: "Active",
    description:
      "Receiving procedure for flight hardware: certificates, NDAA and origin evidence, packaging and critical dimensions before stock-in.",
    steps: [
      {
        name: "Certificate of conformance matches PO and drawing revision",
        type: "Checkbox",
        required: true
      },
      {
        name: "NDAA compliance letter and country of origin on file",
        type: "Checkbox",
        required: true
      },
      {
        name: "Packaging and ESD condition on arrival",
        type: "List",
        required: true,
        listValues: [
          "ESD-sealed, intact",
          "ESD seal broken",
          "Out of specification"
        ]
      },
      {
        name: "Hinge-pin bore gauge engagement",
        description: "Measured with the go plug gauge fully seated.",
        type: "Measurement",
        required: true,
        unitOfMeasureCode: "INCH",
        minValue: 0.4,
        maxValue: 0.5
      }
    ]
  },
  {
    name: "ESD Control Plan (ANSI/ESD S20.20)",
    version: 0,
    status: "Draft",
    description:
      "Draft ESD control plan for the avionics integration cell — grounding, wrist-strap checks and packaging.",
    steps: []
  }
];

export const GAUGES: GaugeSpec[] = [
  {
    key: "gauge-blocks",
    gaugeType: "Gauge Block",
    description: "Grade K steel gauge block set, 81 pc — metrology lab master",
    modelNumber: "GBS-81K",
    serialNumber: "MB-22-0144",
    role: "Master",
    status: "Active",
    calibrationIntervalInMonths: 12,
    acquiredOffset: -700,
    calibrations: [
      {
        dateOffset: -560,
        result: "Pass",
        temperature: 20,
        humidity: 45,
        measurementStandard: "ISO 3650, NIST-traceable interferometry"
      },
      {
        dateOffset: -200,
        result: "Pass",
        temperature: 20,
        humidity: 43,
        measurementStandard: "ISO 3650, NIST-traceable interferometry"
      }
    ]
  },
  {
    key: "caliper",
    gaugeType: "Caliper - Outside",
    description: "150 mm digital caliper — new unit for the integration cell",
    modelNumber: "DC-150",
    serialNumber: "C24-88213",
    role: "Standard",
    status: "Active",
    calibrationIntervalInMonths: 6,
    acquiredOffset: -10,
    calibrations: []
  },
  {
    key: "micrometer",
    gaugeType: "Micrometer - Outside",
    description:
      "0–25 mm outside micrometer — retired after failed calibration",
    modelNumber: "OM-25",
    serialNumber: "M19-40522",
    role: "Standard",
    status: "Inactive",
    calibrationIntervalInMonths: 6,
    acquiredOffset: -900,
    calibrations: [
      { dateOffset: -400, result: "Pass", temperature: 20, humidity: 46 },
      {
        dateOffset: -220,
        result: "Fail",
        requiresAction: true,
        requiresRepair: true,
        temperature: 20,
        humidity: 44,
        notes: "Anvil faces worn — flatness 1.8 µm, limit 0.6 µm. Retired."
      }
    ]
  }
];

export const RISKS: RiskSpec[] = [
  {
    title: "Single-source carbon arm supplier quality",
    description:
      "Sentry is the only qualified source for ARM-CF-30 and has now shipped two escapes in one lot.",
    type: "Risk",
    status: "Mitigating",
    severity: 5,
    likelihood: 3,
    source: "Supplier",
    supplier: "Sentry Propulsion Systems"
  },
  {
    title: "Export classification review on payload spares",
    description:
      "The Army office requested EO/IR gimbal spares that may fall under USML XII(c) — confirm the classification before shipment.",
    type: "Risk",
    status: "In Review",
    severity: 4,
    likelihood: 2,
    source: "Customer",
    customer: "Army Small UAS Program Office"
  },
  {
    title: "Gen1 motor magnets fail the 2027 DFARS magnet rule",
    description:
      "MTR-4114-G1 stator magnets are Chinese-origin NdFeB. DFARS 252.225-7052 bars them from 1 Jan 2027, so Gen2 must replace Gen1 in every open build.",
    type: "Risk",
    status: "Open",
    severity: 3,
    likelihood: 3,
    source: "Item",
    item: "MTR-4114-G1"
  },
  {
    title: "Environmental chamber availability for ISR4-AV acceptance",
    description:
      "The environmental chamber was double-booked for the acceptance window; slot confirmed with the outside test house.",
    type: "Risk",
    status: "Closed",
    severity: 3,
    likelihood: 2,
    source: "Job",
    job: "job:in-progress"
  },
  {
    title: "Qualify a second PDB board fab to cut lead time",
    description:
      "A second IPC-6012 Class 3 fab could halve the 21-day PCB lead time — accepted into next year's plan.",
    type: "Opportunity",
    status: "Accepted",
    severity: 2,
    likelihood: 4,
    source: "General"
  }
];

export const defenseQuality: QualityData = {
  workflows: WORKFLOWS,
  nonConformances: NON_CONFORMANCES,
  inspections: INSPECTIONS,
  qualityDocuments: QUALITY_DOCUMENTS,
  gauges: GAUGES,
  risks: RISKS
};
