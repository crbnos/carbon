import type {
  GaugeSpec,
  InspectionSpec,
  NonConformanceSpec,
  QualityData,
  QualityDocumentSpec,
  RiskSpec
} from "../../types.ts";

export const NON_CONFORMANCES: NonConformanceSpec[] = [
  {
    ref: "ncr:eps",
    name: "EPS wiring harness short detected",
    source: "Internal",
    status: "In Progress",
    openDateOffset: -312,
    quantity: 1,
    priority: "High",
    // An issue raised on the floor is raised against the operation that produced
    // it. Without this link the issue page's Associations card is empty.
    jobOperation: { job: "job:in-progress" },
    items: [{ item: "SAT-1000", quantity: 1 }]
  },
  {
    ref: "ncr:fastener",
    name: "Fastener torque below spec on panel section 4C",
    source: "Internal",
    status: "Registered",
    openDateOffset: -285,
    quantity: 12,
    priority: "Medium"
  },
  // ── Supplier escape: raised off the receiving inspection of the short tank
  // delivery. Linked to PropTech, the exact PO line, and the inspection lot.
  {
    ref: "ncr:tank-wall",
    name: "Propellant tank wall below minimum thickness at girth weld",
    description:
      "Receiving inspection on the PropTech short delivery measured 1.12 mm wall at the girth weld of one TANK-TI-4L against a 1.15 mm minimum. Tank quarantined; MRB to decide return-to-vendor vs. use-as-is with stress analysis.",
    type: "Supplier Issue",
    source: "External",
    status: "In Progress",
    openDateOffset: -78,
    dueDateOffset: 14,
    quantity: 1,
    priority: "Critical",
    supplier: "PropTech Solutions",
    purchaseOrderLine: { po: "po:closed-short", item: "TANK-TI-4L" },
    inspection: "insp:tank",
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
        dueDateOffset: 7
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
  // ── Customer complaint on shipped spares, worked to closure.
  {
    ref: "ncr:txrx-tvac",
    name: "Customer-reported S-band transponder spare fails TVAC pre-screen",
    description:
      "NovaSat reported one of two TXRX-SBAND spares drifting 40 kHz off channel at the cold plateau of their TVAC pre-screen. Unit returned for evaluation; root cause traced to an unstaked TCXO shield lid.",
    type: "Customer Complaint",
    source: "External",
    status: "Closed",
    openDateOffset: -12,
    dueDateOffset: 2,
    closeDateOffset: -3,
    quantity: 1,
    priority: "Low",
    customer: "NovaSat Networks",
    salesOrderLine: "soline:novasat-spares:txrx",
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
  // ── A quarantined lot waiting on disposition.
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
    actionTasks: [
      { action: "Containment Action", status: "Pending", dueDateOffset: 2 }
    ]
  }
];

// Receiving inspection of the two tanks PropTech delivered short. Lot of 2 at
// AQL 1.0 / level II resolves to code letter A, n = 2 — every tank inspected.
export const INSPECTION: InspectionSpec = {
  ref: "insp:tank",
  receipt: "receipt:short",
  item: "TANK-TI-4L",
  drawingNumber: "PT-4L-100 Rev C",
  aql: 1.0,
  features: [
    {
      label: "1",
      description: "Inlet port thread pitch diameter (7/16-20 UNJF)",
      nominalValue: "0.4050",
      tolerancePlus: "0.0020",
      toleranceMinus: "0.0020",
      unit: "in"
    },
    {
      label: "2",
      description: "Wall thickness at girth weld (UT)",
      nominalValue: "1.20",
      tolerancePlus: "0.10",
      toleranceMinus: "0.05",
      unit: "mm"
    }
  ],
  status: "Partial",
  dispositionOffset: -78,
  notes:
    "S/N 0417 accepted. S/N 0418 wall under minimum at the girth weld — quarantined and raised to MRB.",
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
};

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
      "Receiving procedure for flight hardware: paperwork, cleanliness and critical dimensions before stock-in.",
    steps: [
      {
        name: "Certificate of conformance matches PO and drawing revision",
        type: "Checkbox",
        required: true
      },
      {
        name: "Precision-cleanliness level on arrival",
        type: "List",
        required: true,
        listValues: ["Level 100A", "Level 300A", "Out of specification"]
      },
      {
        name: "Port thread engagement length",
        description: "Measured with the plug gauge fully seated.",
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
    title: "Single-source titanium tank supplier weld quality",
    description:
      "PropTech is the only qualified source for TANK-TI-4L and has now shipped two escapes in one lot.",
    type: "Risk",
    status: "Mitigating",
    severity: 5,
    likelihood: 3,
    source: "Supplier",
    supplier: "PropTech Solutions"
  },
  {
    title: "Export classification review on propulsion spares",
    description:
      "ORBSEC requested propulsion spares that may move to a stricter ITAR category — confirm before shipment.",
    type: "Risk",
    status: "In Review",
    severity: 4,
    likelihood: 2,
    source: "Customer",
    customer: "ORBSEC Defense"
  },
  {
    title: "Reaction wheel bearing obsolescence",
    description:
      "The RW-010 bearing vendor announced end-of-life for the current cage material.",
    type: "Risk",
    status: "Open",
    severity: 3,
    likelihood: 3,
    source: "Item",
    item: "RW-010"
  },
  {
    title: "TVAC chamber availability for SAT-1000 acceptance",
    description:
      "Shared TVAC chamber was double-booked for the acceptance window; slot confirmed with the test house.",
    type: "Risk",
    status: "Closed",
    severity: 3,
    likelihood: 2,
    source: "Job",
    job: "job:in-progress"
  },
  {
    title: "Qualify a second EPS board fab to cut lead time",
    description:
      "A second IPC-6012 Class 3 fab could halve the 21-day PCB lead time — accepted into next year's plan.",
    type: "Opportunity",
    status: "Accepted",
    severity: 2,
    likelihood: 4,
    source: "General"
  }
];

export const satelliteQuality: QualityData = {
  nonConformances: NON_CONFORMANCES,
  inspection: INSPECTION,
  qualityDocuments: QUALITY_DOCUMENTS,
  gauges: GAUGES,
  risks: RISKS
};
