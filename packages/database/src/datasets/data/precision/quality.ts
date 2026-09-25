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
    name: "Supplier Escape — Purchased Components",
    description:
      "A purchased component failed receiving inspection. Quarantine it, work the root cause with the supplier, and record their corrective action before MRB closes it out.",
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
    key: "customer-complaint",
    name: "Customer Complaint — Delivered Parts",
    description:
      "A customer reported a defect on delivered parts. Acknowledge the same day, contain stock and WIP, and put the corrective action on record before closing.",
    priority: "Medium",
    source: "External",
    requiredActions: [
      "Customer Communication",
      "Containment Action",
      "Corrective Action"
    ]
  },
  {
    key: "incoming-hold",
    name: "Incoming Lot Hold",
    description:
      "An incoming lot is missing a certificate or failed a visual check. Hold it, then verify it before release.",
    priority: "Medium",
    source: "Internal",
    requiredActions: ["Containment Action", "Verification"]
  }
];

export const NON_CONFORMANCES: NonConformanceSpec[] = [
  {
    ref: "ncr:anodize",
    assignee: "self",
    name: "Hard anodize thickness below print on manifold blocks",
    source: "Internal",
    status: "In Progress",
    // On or after the in-progress job's released date (-160) — an NCR cannot be
    // raised against an operation that had not been handed to the floor yet.
    openDateOffset: -150,
    quantity: 4,
    priority: "High",
    // An issue raised on the floor is raised against the operation that produced
    // it. Without this link the issue page's Associations card is empty.
    jobOperation: { job: "job:in-progress" },
    items: [{ item: "MCH-MANI-BLK", quantity: 4 }]
  },
  {
    ref: "ncr:bore",
    items: [{ item: "MCH-HSG-PUMP", quantity: 3 }],
    name: "Pump housing bearing bore oversize at second operation",
    source: "Internal",
    status: "Registered",
    openDateOffset: -142,
    quantity: 3,
    priority: "Medium"
  },
  {
    ref: "ncr:needle-od",
    items: [
      {
        item: "BRG-NDL-HK1512",
        quantity: 1,
        disposition: "Return to Supplier"
      },
      { item: "MCH-HSG-PUMP", quantity: 4 }
    ],
    assignee: "self",
    workflow: "supplier-escape",
    purchaseReturnLine: {
      purchaseReturn: "needle-od-rtv",
      line: 1,
      quantity: 1
    },
    name: "HK1512 needle bearing cup OD oversize — press fit out of range",
    description:
      "Receiving inspection on the Midway needle-bearing delivery measured one HK1512 drawn cup at 21.016 mm OD against a 21.000 ±0.010 mm limit. An oversize cup over-closes the rollers when pressed into the pump housing bore. Bearing tagged and quarantined; MRB to decide return-to-vendor vs. 100% ring-gauge sort of the remaining stock.",
    type: "Supplier Issue",
    source: "External",
    status: "In Progress",
    openDateOffset: -66,
    dueDateOffset: 14,
    quantity: 1,
    priority: "Critical",
    supplier: "Midway Bearing & Seal",
    purchaseOrderLine: { po: "po:midway-paid", item: "BRG-NDL-HK1512" },
    inspection: "insp:needle",
    actionTasks: [
      {
        action: "Containment Action",
        status: "Completed",
        dueDateOffset: -64,
        completedOffset: -65
      },
      {
        action: "Root Cause Analysis",
        status: "In Progress",
        dueDateOffset: 7,
        processes: ["CNC Milling"]
      },
      { action: "Corrective Action", status: "Pending", dueDateOffset: 21 }
    ],
    mrb: {
      status: "In Progress",
      dueDateOffset: 10,
      reviewers: [
        { title: "Engineering", status: "Completed", completedOffset: -60 },
        { title: "Quality", status: "In Progress" }
      ]
    }
  },
  {
    ref: "ncr:clevis-pins",
    items: [{ item: "PIN-CLEVIS-12", quantity: 12, disposition: "Rework" }],
    workflow: "customer-complaint",
    salesReturnLine: { salesReturn: "clevis-pins", line: 1 },
    name: "Customer-reported clevis pins with scuffed zinc plating and cross-hole burrs",
    description:
      "Cedar Valley Hydraulics reported that several of the 12 PIN-CLEVIS-12 shipped on the partial delivery arrived with the zinc plating scuffed through at the shank and a burr left in the cotter-pin cross hole. Root cause: pins packed loose in one carton with no dividers. Now bagged in tens with a divider insert.",
    type: "Customer Complaint",
    source: "External",
    status: "Closed",
    openDateOffset: -8,
    dueDateOffset: 5,
    closeDateOffset: -2,
    quantity: 12,
    priority: "Low",
    customer: "Cedar Valley Hydraulics",
    salesOrderLine: "soline:cedarvalley-pins:pin",
    actionTasks: [
      {
        action: "Customer Communication",
        status: "Completed",
        dueDateOffset: -7,
        completedOffset: -8
      },
      {
        action: "Containment Action",
        status: "Completed",
        dueDateOffset: -6,
        completedOffset: -7
      },
      {
        action: "Corrective Action",
        status: "Completed",
        dueDateOffset: -3,
        completedOffset: -3
      }
    ]
  },
  {
    ref: "ncr:brg-lot",
    items: [{ item: "BRG-DBL-6205", quantity: 2 }],
    // Feeds the supplier-quality KPI's issue this month.
    supplier: "Midway Bearing & Seal",
    workflow: "incoming-hold",
    name: "6205-2RS bearing lot on hold — grease-fill certificate missing, seal lip rolled",
    description:
      "Lot LOT-BRG-2613 arrived without the vendor's grease-fill certificate, and one of the two bearings shows a rolled seal lip on visual. Lot placed on hold in B1-L3 pending the certificate and a spin-torque check.",
    type: "Material Issue",
    source: "Internal",
    status: "Registered",
    openDateOffset: -6,
    dueDateOffset: 20,
    quantity: 2,
    priority: "Medium",
    trackedEntity: "LOT-BRG-2613",
    actionTasks: [
      { action: "Containment Action", status: "Pending", dueDateOffset: 2 },
      { action: "Verification", status: "Pending", dueDateOffset: 14 }
    ]
  }
];

// Lot of 10 at AQL 1.0 / level II → code letter B, n = 3.
const NEEDLE_PLAN = {
  drawingNumber: "MW-HK1512 Rev B",
  aql: 1.0,
  features: [
    {
      label: "1",
      description: "Drawn cup outside diameter (ring gauge, 3-point)",
      nominalValue: "21.000",
      tolerancePlus: "0.010",
      toleranceMinus: "0.010",
      unit: "mm"
    },
    {
      label: "2",
      description: "Cup width",
      nominalValue: "12.00",
      tolerancePlus: "0.00",
      toleranceMinus: "0.30",
      unit: "mm"
    }
  ] satisfies InspectionFeatureSpec[]
};

export const INSPECTIONS: InspectionSpec[] = [
  {
    source: "Receipt",
    ref: "insp:needle",
    receipt: "receipt:midway-paid",
    item: "BRG-NDL-HK1512",
    ...NEEDLE_PLAN,
    status: "Partial",
    dispositionOffset: -66,
    notes:
      "Samples 1 and 3 accepted. Sample 2 cup OD 21.016 mm, over the 21.010 mm upper limit — tagged, quarantined and raised to MRB.",
    samples: [
      {
        status: "Passed",
        inspectedOffset: -67,
        measurements: [
          { feature: "1", value: 21.004 },
          { feature: "2", value: 11.88 }
        ]
      },
      {
        status: "Failed",
        inspectedOffset: -67,
        measurements: [
          { feature: "1", value: 21.016 },
          { feature: "2", value: 11.91 }
        ]
      },
      {
        status: "Passed",
        inspectedOffset: -67,
        measurements: [
          { feature: "1", value: 20.997 },
          { feature: "2", value: 11.85 }
        ]
      }
    ]
  },
  // 20 pieces at AQL 1.0 → n = 5.
  {
    source: "Receipt",
    ref: "insp:ptfe-bushings",
    receipt: "receipt:midway-restock",
    item: "BSH-PTFE-2012",
    drawingNumber: "MW-PTFE-2012 Rev A",
    aql: 1.0,
    features: [
      {
        label: "1",
        description: "Outside diameter",
        nominalValue: "23.000",
        tolerancePlus: "0.020",
        toleranceMinus: "0.020",
        unit: "mm"
      },
      {
        label: "2",
        description: "Overall length",
        nominalValue: "12.00",
        tolerancePlus: "0.25",
        toleranceMinus: "0.25",
        unit: "mm"
      }
    ],
    status: "Passed",
    dispositionOffset: -1,
    notes: "Five bushings measured; OD and length well inside print.",
    samples: [
      {
        status: "Passed",
        inspectedOffset: -1,
        measurements: [
          { feature: "1", value: 23.004 },
          { feature: "2", value: 12.02 }
        ]
      },
      {
        status: "Passed",
        inspectedOffset: -1,
        measurements: [
          { feature: "1", value: 22.998 },
          { feature: "2", value: 11.97 }
        ]
      },
      {
        status: "Passed",
        inspectedOffset: -1,
        measurements: [
          { feature: "1", value: 23.009 },
          { feature: "2", value: 12.05 }
        ]
      },
      {
        status: "Passed",
        inspectedOffset: -1,
        measurements: [
          { feature: "1", value: 23.001 },
          { feature: "2", value: 11.99 }
        ]
      },
      {
        status: "Passed",
        inspectedOffset: -1,
        measurements: [
          { feature: "1", value: 22.995 },
          { feature: "2", value: 12.01 }
        ]
      }
    ]
  },
  {
    source: "Receipt",
    ref: "insp:needle-restock",
    receipt: "receipt:midway-restock",
    item: "BRG-NDL-HK1512",
    ...NEEDLE_PLAN,
    status: "Pending",
    samples: []
  },
  {
    source: "Job Operation",
    ref: "insp:shaft-runout",
    job: "floor-shaft",
    status: "Pending",
    samples: []
  }
];

export const QUALITY_DOCUMENTS: QualityDocumentSpec[] = [
  {
    name: "Machined Part First Article Inspection",
    version: 1,
    status: "Archived",
    description:
      "Superseded first-article procedure — traveler sign-off and visual check only.",
    steps: []
  },
  {
    name: "Machined Part First Article Inspection",
    version: 2,
    status: "Active",
    description:
      "First-article procedure for CNC-machined housings and blocks: material traceability, finish and the critical bearing bore before the lot is released.",
    steps: [
      {
        name: "Mill cert heat number matches the traveler and print revision",
        type: "Checkbox",
        required: true
      },
      {
        name: "Anodize finish on arrival from the finisher",
        type: "List",
        required: true,
        listValues: [
          "Type III hard coat — black",
          "Type II — clear",
          "Out of specification"
        ]
      },
      {
        name: "Bearing bore diameter",
        description:
          "Measured with the dial bore gauge zeroed on the 52 mm setting ring.",
        type: "Measurement",
        required: true,
        unitOfMeasureCode: "INCH",
        minValue: 2.0465,
        maxValue: 2.0475
      }
    ]
  },
  {
    name: "Heat Treat Hardness Verification (Rockwell C)",
    version: 0,
    status: "Draft",
    description:
      "Draft procedure for verifying 4140 drive shafts back from the heat treater — sample plan, test locations and HRC acceptance range.",
    steps: []
  }
];

export const GAUGES: GaugeSpec[] = [
  {
    key: "setting-ring",
    gaugeType: "Ring Gauge",
    description:
      "52 mm class XX master setting ring — zero reference for the bearing-bore gauges",
    modelNumber: "SR-52XX",
    serialNumber: "RG-21-3307",
    supplier: "Precision Gauge Services",
    role: "Master",
    status: "Active",
    calibrationIntervalInMonths: 12,
    acquiredOffset: -720,
    calibrations: [
      {
        dateOffset: -520,
        result: "Pass",
        temperature: 20,
        humidity: 44,
        measurementStandard: "ANSI/ASME B89.1.6, NIST-traceable"
      },
      {
        dateOffset: -160,
        result: "Pass",
        temperature: 20,
        humidity: 42,
        measurementStandard: "ANSI/ASME B89.1.6, NIST-traceable"
      }
    ]
  },
  {
    key: "bore-gauge",
    gaugeType: "Bore Gauge",
    description: "35–60 mm dial bore gauge — new unit for VMC Cell 2",
    modelNumber: "DBG-3560",
    serialNumber: "BG24-10582",
    role: "Standard",
    status: "Active",
    calibrationIntervalInMonths: 6,
    acquiredOffset: -12,
    calibrations: []
  },
  {
    key: "thread-plug",
    gaugeType: "Thread Gauge",
    description:
      "M6 x 1.0 6H GO/NO-GO thread plug — retired after failed calibration",
    modelNumber: "TPG-M6-6H",
    serialNumber: "TP19-00871",
    role: "Standard",
    status: "Inactive",
    calibrationIntervalInMonths: 6,
    acquiredOffset: -820,
    calibrations: [
      { dateOffset: -390, result: "Pass", temperature: 20, humidity: 45 },
      {
        dateOffset: -200,
        result: "Fail",
        requiresAction: true,
        requiresRepair: true,
        temperature: 20,
        humidity: 43,
        notes:
          "GO member pitch diameter worn 0.009 mm below its wear limit. Retired and replaced."
      }
    ]
  }
];

export const RISKS: RiskSpec[] = [
  {
    title: "Needle bearing dimensional escapes from Midway",
    description:
      "Midway is the only stocked source for HK1512 and just shipped an oversize cup — a second escape would stop pump housing assembly.",
    type: "Risk",
    status: "Mitigating",
    severity: 4,
    likelihood: 3,
    source: "Supplier",
    supplier: "Midway Bearing & Seal"
  },
  {
    title: "Passivation and cleanliness certs for medical 316L parts",
    description:
      "Solstice Medical asked for ASTM A967 passivation and cleanliness certificates on stainless parts — confirm Anvil Finishing can certify before the next order.",
    type: "Risk",
    status: "In Review",
    severity: 3,
    likelihood: 3,
    source: "Customer",
    customer: "Solstice Medical Devices"
  },
  {
    title: "Hard chrome plating on piston rods under regulatory pressure",
    description:
      "Hexavalent chrome rules may close our only plater for MCH-PISTON-ROD; nitride or HVOF alternatives need customer approval.",
    type: "Risk",
    status: "Open",
    severity: 4,
    likelihood: 2,
    source: "Item",
    item: "MCH-PISTON-ROD"
  },
  {
    title: "Hydro proof test bench availability for the HMA-4000 lot",
    description:
      "The shared hydrostatic test bench was booked for a rework loop during the HMA-4000 proof-test window; slot moved to second shift.",
    type: "Risk",
    status: "Closed",
    severity: 3,
    likelihood: 2,
    source: "Job",
    job: "job:in-progress"
  },
  {
    title: "Pallet pool on VMC Cell 2 for lights-out manifold blocks",
    description:
      "A 6-pallet pool would let manifold block roughing run unattended overnight — accepted into next year's capital plan.",
    type: "Opportunity",
    status: "Accepted",
    severity: 2,
    likelihood: 4,
    source: "General"
  }
];

export const precisionQuality: QualityData = {
  workflows: WORKFLOWS,
  nonConformances: NON_CONFORMANCES,
  inspections: INSPECTIONS,
  qualityDocuments: QUALITY_DOCUMENTS,
  gauges: GAUGES,
  risks: RISKS
};
