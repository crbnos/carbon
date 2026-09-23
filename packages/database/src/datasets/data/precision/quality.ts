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
    ref: "ncr:anodize",
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
    name: "Pump housing bearing bore oversize at second operation",
    source: "Internal",
    status: "Registered",
    openDateOffset: -142,
    quantity: 3,
    priority: "Medium"
  },
  // ── Supplier escape: raised off the receiving inspection of the Midway
  // needle-bearing delivery. Linked to Midway, the exact PO line, and the lot.
  {
    ref: "ncr:needle-od",
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
        dueDateOffset: 7
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
  // ── Customer complaint on a posted spares shipment, worked to closure.
  {
    ref: "ncr:clevis-pins",
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
  // ── A held bearing lot waiting on disposition.
  {
    ref: "ncr:brg-lot",
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

// Receiving inspection of the ten HK1512 needle bearings Midway delivered. Lot
// of 10 at AQL 1.0 / level II resolves to code letter B, n = 3.
export const INSPECTION: InspectionSpec = {
  ref: "insp:needle",
  receipt: "receipt:midway-paid",
  item: "BRG-NDL-HK1512",
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
  ],
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
};

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
  nonConformances: NON_CONFORMANCES,
  inspection: INSPECTION,
  qualityDocuments: QUALITY_DOCUMENTS,
  gauges: GAUGES,
  risks: RISKS
};
