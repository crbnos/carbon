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
    ref: "ncr:insulation",
    name: "Stator insulation resistance below spec after impregnation",
    source: "Internal",
    status: "In Progress",
    // On or after the in-progress job's released date (-297) — an NCR cannot be
    // raised against an operation that had not been handed to the floor yet.
    openDateOffset: -288,
    quantity: 1,
    priority: "High",
    // An issue raised on the floor is raised against the operation that produced
    // it. Without this link the issue page's Associations card is empty.
    jobOperation: { job: "job:in-progress" },
    items: [{ item: "MTR-9000", quantity: 1 }]
  },
  {
    ref: "ncr:magnet",
    name: "Magnet lot received with chipped nickel plating",
    source: "External",
    status: "Registered",
    openDateOffset: -281,
    quantity: 36,
    priority: "Medium"
  },
  // ── Supplier escape: raised off the receiving inspection of the Copperline
  // Nomex delivery. Linked to Copperline, the exact PO line, and the lot.
  {
    ref: "ncr:nomex-thin",
    name: "Nomex 410 slot liner under minimum thickness on incoming roll",
    description:
      "Receiving inspection on the Copperline wire-and-insulation delivery measured 0.21 mm on one sample of MAT-INS-NOMEX against a 0.22 mm minimum. Thin liner cuts the slot-to-winding creepage margin and risks hipot failure after impregnation. Roll quarantined at the winding crib; MRB to decide return-to-vendor vs. restricted use on the 4500 frame.",
    type: "Supplier Issue",
    source: "External",
    status: "In Progress",
    openDateOffset: -66,
    dueDateOffset: 14,
    quantity: 4,
    priority: "Critical",
    supplier: "Copperline Wire Works",
    purchaseOrderLine: { po: "po:wire-paid", item: "MAT-INS-NOMEX" },
    inspection: "insp:nomex",
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
        { title: "Engineering", status: "Completed", completedOffset: -58 },
        { title: "Quality", status: "In Progress" }
      ]
    }
  },
  // ── Customer complaint on shipped spares, worked to closure.
  {
    ref: "ncr:fan-noise",
    name: "Customer-reported axial cooling fan spare noisy at start-up",
    description:
      "Cardinal Motorworks reported one of two FAN-AX-160 spares ticking at start-up once fitted to a TD-9000 non-drive end. Unit returned for evaluation; a blade tip was rubbing the shroud after a dropped carton bent the guard ring in transit.",
    type: "Customer Complaint",
    source: "External",
    status: "Closed",
    openDateOffset: -12,
    dueDateOffset: 2,
    closeDateOffset: -3,
    quantity: 1,
    priority: "Low",
    customer: "Cardinal Motorworks",
    salesOrderLine: "soline:cardinal-fans:fan",
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
  // ── A quarantined magnet lot waiting on disposition.
  {
    ref: "ncr:mag-lot",
    name: "N45SH magnet lot on hold — flux report missing, low remanence on spot check",
    description:
      "Lot LOT-MAG45-2609 arrived without the vendor's magnetization flux report, and a Gaussmeter spot check read surface flux 4% below the other N45SH lots. Lot held in the magnet vault pending the report and a sample demagnetization-curve test before any rotor bonding.",
    type: "Material Issue",
    source: "Internal",
    status: "Registered",
    openDateOffset: -5,
    dueDateOffset: 21,
    quantity: 3,
    priority: "Medium",
    trackedEntity: "LOT-MAG45-2609",
    actionTasks: [
      { action: "Containment Action", status: "Pending", dueDateOffset: 2 },
      { action: "Incoming Materials", status: "Pending", dueDateOffset: 9 }
    ]
  }
];

// Receiving inspection of the 20 lb of Nomex 410 Copperline shipped with the
// magnet wire. Lot of 20 at AQL 1.0 / level II resolves to code letter C,
// n = 5 — five cut coupons, one from each spool layer.
export const INSPECTION: InspectionSpec = {
  ref: "insp:nomex",
  receipt: "receipt:wire-paid",
  item: "MAT-INS-NOMEX",
  drawingNumber: "SPEC-INS-410 Rev B",
  aql: 1.0,
  features: [
    {
      label: "1",
      description: "Paper thickness (10 mil grade), deadweight micrometer",
      nominalValue: "0.25",
      tolerancePlus: "0.03",
      toleranceMinus: "0.03",
      unit: "mm"
    },
    {
      label: "2",
      description: "Slit width for the 9000-frame slot cuff",
      nominalValue: "38.0",
      tolerancePlus: "0.3",
      toleranceMinus: "0.3",
      unit: "mm"
    }
  ],
  status: "Partial",
  dispositionOffset: -66,
  notes:
    "Four coupons in tolerance. Coupon 3 measured 0.21 mm — under the 0.22 mm minimum. Roll quarantined and raised to MRB.",
  samples: [
    {
      status: "Passed",
      inspectedOffset: -67,
      measurements: [
        { feature: "1", value: 0.25 },
        { feature: "2", value: 38.1 }
      ]
    },
    {
      status: "Passed",
      inspectedOffset: -67,
      measurements: [
        { feature: "1", value: 0.24 },
        { feature: "2", value: 37.9 }
      ]
    },
    {
      status: "Failed",
      inspectedOffset: -67,
      measurements: [
        { feature: "1", value: 0.21 },
        { feature: "2", value: 38.0 }
      ]
    },
    {
      status: "Passed",
      inspectedOffset: -67,
      measurements: [
        { feature: "1", value: 0.26 },
        { feature: "2", value: 38.2 }
      ]
    },
    {
      status: "Passed",
      inspectedOffset: -66,
      measurements: [
        { feature: "1", value: 0.25 },
        { feature: "2", value: 37.8 }
      ]
    }
  ]
};

export const QUALITY_DOCUMENTS: QualityDocumentSpec[] = [
  {
    name: "Magnet Wire & Insulation Receiving Inspection",
    version: 1,
    status: "Archived",
    description:
      "Superseded receiving procedure for winding materials — label and certificate review only.",
    steps: []
  },
  {
    name: "Magnet Wire & Insulation Receiving Inspection",
    version: 2,
    status: "Active",
    description:
      "Receiving procedure for magnet wire and slot insulation: paperwork, spool condition and conductor size before release to the winding crib.",
    steps: [
      {
        name: "Mill certificate matches PO, NEMA MW 35-C grade and thermal class",
        type: "Checkbox",
        required: true
      },
      {
        name: "Spool condition on arrival",
        type: "List",
        required: true,
        listValues: ["Intact", "Flange damaged", "Wire crossed or kinked"]
      },
      {
        name: "Bare conductor diameter (18 AWG)",
        description: "Strip the enamel and measure with the bench micrometer.",
        type: "Measurement",
        required: true,
        unitOfMeasureCode: "INCH",
        minValue: 0.04,
        maxValue: 0.0406
      }
    ]
  },
  {
    name: "Stator Hipot & Surge Test Procedure (IEC 60034-1)",
    version: 0,
    status: "Draft",
    description:
      "Draft end-of-line procedure for wound stators — insulation resistance, hipot to frame and surge comparison between phases.",
    steps: []
  }
];

export const GAUGES: GaugeSpec[] = [
  {
    key: "gauge-blocks",
    gaugeType: "Gauge Block",
    description:
      "Grade 0 steel gauge block set, 47 pc — inspection bench master",
    modelNumber: "GBS-47-0",
    serialNumber: "GB-21-0388",
    role: "Master",
    status: "Active",
    calibrationIntervalInMonths: 12,
    acquiredOffset: -720,
    calibrations: [
      {
        dateOffset: -540,
        result: "Pass",
        temperature: 20,
        humidity: 44,
        measurementStandard: "ISO 3650, NIST-traceable comparison"
      },
      {
        dateOffset: -180,
        result: "Pass",
        temperature: 20,
        humidity: 42,
        measurementStandard: "ISO 3650, NIST-traceable comparison"
      }
    ]
  },
  {
    key: "magnet-micrometer",
    gaugeType: "Micrometer - Outside",
    description:
      "0–25 mm outside micrometer — new unit for magnet segment thickness at incoming",
    modelNumber: "OM-25D",
    serialNumber: "M26-11907",
    role: "Standard",
    status: "Active",
    calibrationIntervalInMonths: 6,
    acquiredOffset: -8,
    calibrations: []
  },
  {
    key: "stator-bore-gauge",
    gaugeType: "Bore Gauge",
    description:
      "150–200 mm dial bore gauge for stator bore after impregnation — retired after failed calibration",
    modelNumber: "DBG-200",
    serialNumber: "BG18-30271",
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
          "Centralizing plunger sticking after varnish contamination — repeatability 9 µm, limit 3 µm. Retired."
      }
    ]
  }
];

export const RISKS: RiskSpec[] = [
  {
    title: "Single-source N45SH magnet supplier lot consistency",
    description:
      "Meridian is the only qualified source for MAG-NDFB-45 and has shipped one plated-chip lot and one lot without a flux report this year.",
    type: "Risk",
    status: "Mitigating",
    severity: 5,
    likelihood: 3,
    source: "Supplier",
    supplier: "Meridian Magnetics"
  },
  {
    title: "AS9100 first-article flow-down on actuation motors",
    description:
      "Halcyon's purchase terms may require a full AS9102 first-article report on every TD-9000 revision — confirm scope before the next shipment.",
    type: "Risk",
    status: "In Review",
    severity: 4,
    likelihood: 2,
    source: "Customer",
    customer: "Halcyon Aerospace Actuation"
  },
  {
    title: "Dysprosium price swing on high-temperature magnet grade",
    description:
      "The SH grade depends on dysprosium; a rare-earth price spike would push MAG-NDFB-45 cost past the TD-9000 quoted margin.",
    type: "Risk",
    status: "Open",
    severity: 3,
    likelihood: 3,
    source: "Item",
    item: "MAG-NDFB-45"
  },
  {
    title: "Impregnation oven slot for the in-progress TD-9000 stator",
    description:
      "The VPI oven was double-booked for the stator's Class H bake cycle; a night-shift slot was confirmed and the bake completed.",
    type: "Risk",
    status: "Closed",
    severity: 3,
    likelihood: 2,
    source: "Job",
    job: "job:in-progress"
  },
  {
    title: "Move the 9000-frame stator to hairpin winding",
    description:
      "Hairpin conductors would lift slot fill and cut winding labor by roughly a third — accepted into next year's tooling plan.",
    type: "Opportunity",
    status: "Accepted",
    severity: 2,
    likelihood: 4,
    source: "General"
  }
];

export const motorQuality: QualityData = {
  nonConformances: NON_CONFORMANCES,
  inspection: INSPECTION,
  qualityDocuments: QUALITY_DOCUMENTS,
  gauges: GAUGES,
  risks: RISKS
};
