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
    name: "Supplier Escape — Drivetrain Components",
    description:
      "A purchased drivetrain part failed receiving inspection. Quarantine it, work the root cause with the supplier, and record their corrective action before MRB closes it out.",
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
    name: "Customer Complaint — Field Return",
    description:
      "A customer reported a fault on a delivered arm or spare. Acknowledge within one business day, contain sister units, and verify the fix before closing.",
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
      "An incoming lot is missing paperwork or failed a screening check. Hold the whole lot until it is released or dispositioned.",
    priority: "Medium",
    source: "Internal",
    requiredActions: ["Containment Action"]
  }
];

export const NON_CONFORMANCES: NonConformanceSpec[] = [
  {
    ref: "ncr:harness",
    assignee: "self",
    name: "Arm harness short detected during continuity test",
    source: "Internal",
    status: "In Progress",
    // On or after the in-progress job's released date (-297) — an NCR cannot be
    // raised against an operation that had not been handed to the floor yet.
    openDateOffset: -290,
    quantity: 1,
    priority: "High",
    // An issue raised on the floor is raised against the operation that produced
    // it. Without this link the issue page's Associations card is empty.
    jobOperation: { job: "job:in-progress" },
    items: [{ item: "ROB-2000", quantity: 1 }]
  },
  {
    ref: "ncr:torque",
    items: [{ item: "FST-M8-SS", quantity: 12 }],
    name: "J1 gearbox fastener torque below spec on base assembly",
    source: "Internal",
    status: "Registered",
    openDateOffset: -285,
    quantity: 12,
    priority: "Medium"
  },
  {
    ref: "ncr:gear-lost-motion",
    items: [
      { item: "GBX-HD-80", quantity: 1, disposition: "Return to Supplier" },
      { item: "DRV-J2-MOD", quantity: 2 }
    ],
    assignee: "self",
    workflow: "supplier-escape",
    purchaseReturnLine: { purchaseReturn: "gearbox-rtv", line: 1, quantity: 1 },
    name: "Harmonic gear set lost motion over limit on incoming bench test",
    description:
      "Receiving inspection on the Torqline short delivery measured 1.6 arc-min lost motion at ±4% rated torque on one GBX-HD-80 against a 1.0 arc-min limit. Gear set quarantined in QC hold; MRB to decide return-to-vendor vs. regrade for a J6 wrist application.",
    type: "Supplier Issue",
    source: "External",
    status: "In Progress",
    openDateOffset: -78,
    dueDateOffset: 14,
    quantity: 1,
    priority: "Critical",
    supplier: "Torqline Gearing",
    purchaseOrderLine: { po: "po:closed-short", item: "GBX-HD-80" },
    inspection: "insp:gear-set",
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
        processes: ["Gearbox Assembly"]
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
    ref: "ncr:drive-fault",
    items: [{ item: "DRV-SRV-400", quantity: 1, disposition: "Rework" }],
    workflow: "customer-return",
    salesReturnLine: { salesReturn: "servodrive", line: 1 },
    name: "Customer-reported servo drive spare faults on first power-up",
    description:
      "Cascade Integration Group reported one of two DRV-SRV-400 spares throwing an encoder-communication fault the first time it was enabled on their cell. Unit returned for evaluation; root cause traced to the drive shipping on a superseded firmware build that predates the 19-bit encoder protocol.",
    type: "Customer Complaint",
    source: "External",
    status: "Closed",
    openDateOffset: -14,
    dueDateOffset: 2,
    closeDateOffset: -3,
    quantity: 1,
    priority: "Low",
    customer: "Cascade Integration Group",
    salesOrderLine: "soline:cascade-drives:drv",
    actionTasks: [
      {
        action: "Customer Communication",
        status: "Completed",
        dueDateOffset: -13,
        completedOffset: -13
      },
      {
        action: "Containment Action",
        status: "Completed",
        dueDateOffset: -10,
        completedOffset: -11
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
    ref: "ncr:enc-lot",
    items: [{ item: "ENC-ABS-19", quantity: 2 }],
    // Feeds the supplier-quality KPI's issue this month.
    supplier: "Northgate Electronics",
    workflow: "incoming-hold",
    name: "Absolute encoder lot on hold — factory calibration certificate missing",
    description:
      "Lot LOT-ENC-2609 arrived without the vendor's factory calibration certificate, so its accuracy cannot be traced for the arm's positional-repeatability claim. Lot placed on hold pending the certificate or an in-house accuracy check.",
    type: "Documentation Error",
    source: "Internal",
    status: "Registered",
    openDateOffset: -6,
    dueDateOffset: 20,
    quantity: 2,
    priority: "Medium",
    trackedEntity: "LOT-ENC-2609",
    actionTasks: [
      { action: "Containment Action", status: "Pending", dueDateOffset: 2 }
    ]
  }
];

// Lot of 2 at AQL 1.0 / level II → code letter A, n = 2.
const BARE_BOARD_PLAN = {
  drawingNumber: "PCB-BARE-4L Fab Dwg Rev B",
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
      description: "Plated through-hole diameter, M12 connector pattern",
      nominalValue: "1.10",
      tolerancePlus: "0.05",
      toleranceMinus: "0.05",
      unit: "mm"
    }
  ] satisfies InspectionFeatureSpec[]
};

export const INSPECTIONS: InspectionSpec[] = [
  {
    source: "Receipt",
    ref: "insp:gear-set",
    receipt: "receipt:short",
    item: "GBX-HD-80",
    drawingNumber: "TQ-HD80-100 Rev B",
    aql: 1.0,
    features: [
      {
        label: "1",
        description: "Wave generator input bore diameter (Ø14 H7)",
        nominalValue: "14.000",
        tolerancePlus: "0.018",
        toleranceMinus: "0.000",
        unit: "mm"
      },
      {
        label: "2",
        description: "Lost motion at ±4% rated torque",
        nominalValue: "0.6",
        tolerancePlus: "0.4",
        toleranceMinus: "0.6",
        unit: "arcmin"
      }
    ],
    status: "Partial",
    dispositionOffset: -78,
    notes:
      "S/N HD80-2231 accepted. S/N HD80-2232 lost motion over limit — quarantined in QC hold and raised to MRB.",
    samples: [
      {
        status: "Passed",
        inspectedOffset: -79,
        measurements: [
          { feature: "1", value: 14.008 },
          { feature: "2", value: 0.7 }
        ]
      },
      {
        status: "Failed",
        inspectedOffset: -79,
        measurements: [
          { feature: "1", value: 14.011 },
          { feature: "2", value: 1.6 }
        ]
      }
    ]
  },
  // 20 boards at AQL 1.0 → n = 5.
  {
    source: "Receipt",
    ref: "insp:bare-boards",
    receipt: "receipt:paid",
    item: "PCB-BARE-4L",
    ...BARE_BOARD_PLAN,
    status: "Passed",
    dispositionOffset: -67,
    notes: "Five boards measured; thickness and connector holes nominal.",
    samples: [
      {
        status: "Passed",
        inspectedOffset: -67,
        measurements: [
          { feature: "1", value: 1.62 },
          { feature: "2", value: 1.11 }
        ]
      },
      {
        status: "Passed",
        inspectedOffset: -67,
        measurements: [
          { feature: "1", value: 1.57 },
          { feature: "2", value: 1.09 }
        ]
      },
      {
        status: "Passed",
        inspectedOffset: -67,
        measurements: [
          { feature: "1", value: 1.6 },
          { feature: "2", value: 1.12 }
        ]
      },
      {
        status: "Passed",
        inspectedOffset: -67,
        measurements: [
          { feature: "1", value: 1.64 },
          { feature: "2", value: 1.1 }
        ]
      },
      {
        status: "Passed",
        inspectedOffset: -67,
        measurements: [
          { feature: "1", value: 1.59 },
          { feature: "2", value: 1.08 }
        ]
      }
    ]
  },
  {
    source: "Receipt",
    ref: "insp:bare-boards-queue",
    receipt: "receipt:bare-boards",
    item: "PCB-BARE-4L",
    ...BARE_BOARD_PLAN,
    status: "Pending",
    samples: []
  },
  {
    source: "Job Operation",
    ref: "insp:ctrl-fpt",
    job: "floor-ctrl-pcb",
    status: "In Progress",
    notes:
      "Board 1 of 6 on the bed-of-nails; the rest are still on the SMT line.",
    samples: [
      {
        status: "Passed",
        inspectedOffset: -1,
        measurements: [
          { feature: "1", value: 24.1 },
          { feature: "2", value: 2.45 }
        ]
      }
    ]
  }
];

export const QUALITY_DOCUMENTS: QualityDocumentSpec[] = [
  {
    name: "Harmonic Gear Set Receiving Inspection",
    version: 1,
    status: "Archived",
    description:
      "Superseded receiving procedure for harmonic gear sets — visual and certificate review only.",
    steps: []
  },
  {
    name: "Harmonic Gear Set Receiving Inspection",
    version: 2,
    status: "Active",
    description:
      "Receiving procedure for harmonic gear sets: paperwork, lubrication and critical fits before stock-in.",
    steps: [
      {
        name: "Certificate of conformance and backlash report match PO and serial",
        type: "Checkbox",
        required: true
      },
      {
        name: "Flexspline grease condition on arrival",
        type: "List",
        required: true,
        listValues: ["Even film", "Dry spots", "Contaminated"]
      },
      {
        name: "Circular spline pilot diameter",
        description: "Measured with the bore gauge at three clock positions.",
        type: "Measurement",
        required: true,
        unitOfMeasureCode: "INCH",
        minValue: 3.148,
        maxValue: 3.15
      }
    ]
  },
  {
    name: "Collaborative Operation Risk Assessment (ISO/TS 15066)",
    version: 0,
    status: "Draft",
    description:
      "Draft power-and-force-limiting assessment for the ROB-2000 collaborative mode — contact zones, force thresholds and speed limits.",
    steps: []
  }
];

export const GAUGES: GaugeSpec[] = [
  {
    key: "gauge-blocks",
    gaugeType: "Gauge Block",
    description: "Grade 0 steel gauge block set, 87 pc — metrology lab master",
    modelNumber: "GBS-87-0",
    serialNumber: "RB-21-0381",
    role: "Master",
    status: "Active",
    calibrationIntervalInMonths: 12,
    acquiredOffset: -720,
    calibrations: [
      {
        dateOffset: -545,
        result: "Pass",
        temperature: 20,
        humidity: 45,
        measurementStandard: "ISO 3650, NIST-traceable interferometry"
      },
      {
        dateOffset: -180,
        result: "Pass",
        temperature: 20,
        humidity: 44,
        measurementStandard: "ISO 3650, NIST-traceable interferometry"
      }
    ]
  },
  {
    key: "dial-indicator",
    gaugeType: "Dial Indicator",
    description:
      "0.001 mm digital dial indicator — new unit for the gearbox bench lost-motion fixture",
    modelNumber: "DI-12.7D",
    serialNumber: "DI25-30917",
    role: "Standard",
    status: "Active",
    calibrationIntervalInMonths: 6,
    acquiredOffset: -12,
    calibrations: []
  },
  {
    key: "bore-gauge",
    gaugeType: "Bore Gauge",
    description: "35–60 mm dial bore gauge — retired after failed calibration",
    modelNumber: "BG-60",
    serialNumber: "BG18-11746",
    role: "Standard",
    status: "Inactive",
    calibrationIntervalInMonths: 6,
    acquiredOffset: -880,
    calibrations: [
      { dateOffset: -390, result: "Pass", temperature: 20, humidity: 47 },
      {
        dateOffset: -210,
        result: "Fail",
        requiresAction: true,
        requiresRepair: true,
        temperature: 20,
        humidity: 45,
        notes:
          "Measuring anvil worn — repeatability 6 µm against a 2 µm limit. Retired."
      }
    ]
  }
];

export const RISKS: RiskSpec[] = [
  {
    title: "Single-source harmonic gear supplier lost-motion escapes",
    description:
      "Torqline is the only qualified source for GBX-HD-80 and has now shipped a lost-motion escape on a lot already closed short.",
    type: "Risk",
    status: "Mitigating",
    severity: 5,
    likelihood: 3,
    source: "Supplier",
    supplier: "Torqline Gearing"
  },
  {
    title: "Line-uptime penalty clause on the Lakeshore body-shop cells",
    description:
      "Lakeshore's draft supply terms add a per-hour downtime penalty on delivered arms — legal and service are reviewing the exposure.",
    type: "Risk",
    status: "In Review",
    severity: 4,
    likelihood: 2,
    source: "Customer",
    customer: "Lakeshore Automotive"
  },
  {
    title: "Absolute encoder ASIC end-of-life",
    description:
      "The ENC-ABS-19 vendor announced end-of-life for the encoder's position ASIC; a last-time buy or a requalified replacement is needed.",
    type: "Risk",
    status: "Open",
    severity: 3,
    likelihood: 3,
    source: "Item",
    item: "ENC-ABS-19"
  },
  {
    title: "Burn-in rack availability for the ROB-2000 job",
    description:
      "The burn-in rack was double-booked with a controller qualification run for the job's 24-hour duty cycle; the slot has since been confirmed.",
    type: "Risk",
    status: "Closed",
    severity: 3,
    likelihood: 2,
    source: "Job",
    job: "job:in-progress"
  },
  {
    title: "Qualify a second harmonic gear source to cut lead time",
    description:
      "A second harmonic gear maker could halve the 60-day GBX lead time and end the single-source exposure — accepted into next year's plan.",
    type: "Opportunity",
    status: "Accepted",
    severity: 2,
    likelihood: 4,
    source: "General"
  }
];

export const roboticsQuality: QualityData = {
  workflows: WORKFLOWS,
  nonConformances: NON_CONFORMANCES,
  inspections: INSPECTIONS,
  qualityDocuments: QUALITY_DOCUMENTS,
  gauges: GAUGES,
  risks: RISKS
};
