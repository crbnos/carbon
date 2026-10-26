// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  BatchPropertySpec,
  ConfigurationSpec,
  CustomerPartSpec,
  EnforcementRuleSpec,
  InspectionPlanSpec,
  ItemSpec,
  ItemsData,
  MakeMethodSpec,
  PriceOverrideSpec,
  PricingRuleSpec,
  RevisionLadderSpec,
  SupersessionSpec,
  SupplierLinkSpec
} from "../../types.ts";
import { defenseAssembly } from "./assembly.ts";

// ---------------------------------------------------------------------------
// ISR-4 item catalog for Halberd Unmanned Systems
// Namespace items by type so readableIds can't collide across extension tables.
//   Make Parts: ISR4- / AFR- / ARM- / AVN- / BAT- / COM- / ANT- / HRN- /
//               PCB-PDB- / PCB-FCB-
//   Buy Parts:  BAT-SMART- / ESC- / GMB- / RDO- / PRP- / ARM-CF- / MTR- / FC- /
//               MCU- / GNSS- / GCS- / CASE- / FST- / ISO- / PCB-BARE-
//   MAT- = Materials, TL- = Tools, CN- = Consumables; services are keyed by name
// PCB- spans both: the bare board is bought, the populated assemblies are made.
// ---------------------------------------------------------------------------

/**
 * The part custom fields (ops.customFields) a defense buyer expects on every
 * part: export jurisdiction and class, origin, NDAA §848 status and whether the
 * part carries a MIL-STD-130 IUID mark. Demo values, self-classified — not
 * legal advice.
 */
function exportData(
  jurisdiction: "ITAR" | "EAR" | "EAR99",
  classification: string,
  origin: string,
  ndaa: "Yes" | "No" | "Under review",
  iuid: "Yes" | "No",
  magnetOrigin?: string
): Record<string, string> {
  return {
    "Export jurisdiction": jurisdiction,
    "USML / ECCN": classification,
    "Country of origin": origin,
    "NDAA §848 compliant": ndaa,
    "IUID mark required": iuid,
    ...(magnetOrigin
      ? { "Magnet origin (DFARS 252.225-7052)": magnetOrigin }
      : {})
  };
}

const IN_HOUSE_ITAR = exportData("ITAR", "USML VIII(h)(1)", "US", "Yes", "No");

export const BUY_PARTS: ItemSpec[] = [
  // Electronics
  {
    readableId: "BAT-SMART-11AH",
    name: "Smart Battery Pack 11Ah 12S (SMBus)",
    type: "Part",
    replenishment: "Buy",
    // Batch-tracked: receiving captures the cell lot, and the lot is what gets
    // scanned into a power system on the floor.
    trackingType: "Batch",
    standardCost: 1850,
    unitSalePrice: 2750,
    leadTime: 60,
    description:
      "Li-ion pack, US-assembled from Korean cells. Shelf life tracked from the cell lot date.",
    customFieldValues: exportData(
      "EAR99",
      "EAR99",
      "US (cells: KR)",
      "Yes",
      "No"
    )
  },
  {
    readableId: "PCB-BARE-R3",
    name: "Bare PCB, 6-Layer FR-4 (IPC-6012 Class 3)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 85,
    leadTime: 21,
    customFieldValues: exportData("EAR99", "EAR99", "US", "Yes", "No")
  },
  {
    readableId: "ESC-80A-NDAA",
    name: "Motor Controller 80A, NDAA (CAN)",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Serial",
    standardCost: 640,
    unitSalePrice: 960,
    leadTime: 45,
    customFieldValues: exportData("EAR99", "EAR99", "US", "Yes", "No")
  },
  {
    readableId: "GMB-EOIR-640",
    name: "EO/IR Gimbal, 30x EO + 640 LWIR + LRF",
    type: "Part",
    replenishment: "Buy",
    standardCost: 28000,
    unitSalePrice: 42000,
    leadTime: 120,
    description:
      "Stabilized day/thermal sensor with laser rangefinder. A §848 camera and gimbal: origin evidence required on every receipt.",
    customFieldValues: exportData("ITAR", "USML XII(c)", "US", "Yes", "Yes")
  },
  {
    readableId: "RDO-MESH-2X2",
    name: "MANET Mesh Radio, 2x2 MIMO (L/S-Band)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 9500,
    unitSalePrice: 14250,
    leadTime: 90,
    description: "AES-256 encrypted mesh datalink module.",
    customFieldValues: exportData("EAR", "5A002.a", "US", "Yes", "Yes")
  },
  // Propulsion
  {
    readableId: "PRP-2270-CF",
    name: "Propeller Set 22x7 Carbon (CW/CCW Pair)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 340,
    unitSalePrice: 510,
    leadTime: 30,
    customFieldValues: exportData("EAR99", "EAR99", "US", "Yes", "No")
  },
  {
    readableId: "ARM-CF-30",
    name: "Folding Carbon Arm 30 mm, Pre-Drilled",
    type: "Part",
    replenishment: "Buy",
    standardCost: 420,
    unitSalePrice: 630,
    leadTime: 45,
    customFieldValues: exportData("EAR99", "EAR99", "US", "Yes", "No")
  },
  {
    readableId: "MTR-4114-G1",
    name: "Brushless Motor 4114 380KV, NDAA — Gen1",
    type: "Part",
    replenishment: "Buy",
    standardCost: 950,
    unitSalePrice: 1425,
    leadTime: 45,
    description:
      "Gen1 stator magnets are Chinese-origin NdFeB. Being phased out for Gen2 ahead of the 2027 DFARS 252.225-7052 magnet rule.",
    customFieldValues: exportData(
      "EAR99",
      "EAR99",
      "TW",
      "Under review",
      "No",
      "CN"
    )
  },
  // Structural buy parts
  {
    readableId: "FST-M3-TI",
    name: "M3 x 8 Titanium Socket Cap Screw (DFARS)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 2.5,
    unitSalePrice: 4,
    leadTime: 14,
    description:
      "Specialty metal, melted in a qualifying country (DFARS 252.225-7009).",
    customFieldValues: exportData("EAR99", "EAR99", "US", "Yes", "No")
  },
  {
    readableId: "FST-M5-A286",
    name: "M5 x 12 A286 Socket Cap Screw (DFARS)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 5.5,
    unitSalePrice: 8,
    leadTime: 14,
    description:
      "Specialty metal, melted in a qualifying country (DFARS 252.225-7009).",
    customFieldValues: exportData("EAR99", "EAR99", "US", "Yes", "No")
  },
  {
    readableId: "ISO-DAMP-M3",
    name: "Silicone Vibration Isolator, M3",
    type: "Part",
    replenishment: "Buy",
    standardCost: 18,
    unitSalePrice: 27,
    leadTime: 10,
    customFieldValues: exportData("EAR99", "EAR99", "MX", "Yes", "No")
  },
  // Deliberately absent from every BOM: job creation and picking redirect to it via SUPERSESSIONS.
  {
    readableId: "MTR-4114-G2",
    name: "Brushless Motor 4114 380KV, NDAA — Gen2",
    type: "Part",
    replenishment: "Buy",
    standardCost: 1050,
    unitSalePrice: 1575,
    leadTime: 30,
    description:
      "Gen2: US-origin magnets and winding. Successor to MTR-4114-G1.",
    customFieldValues: exportData("EAR99", "EAR99", "US", "Yes", "No", "US")
  },
  {
    readableId: "FC-NDAA-H7",
    name: "Flight Controller, NDAA, Triple-Redundant IMU",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Serial",
    standardCost: 3200,
    unitSalePrice: 4800,
    leadTime: 60,
    description:
      "Blue UAS Framework flight controller. A §848 critical component.",
    customFieldValues: exportData("EAR99", "EAR99", "US", "Yes", "Yes")
  },
  {
    readableId: "MCU-EDGE-16",
    name: "Mission Computer, Edge AI, 16 GB",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Serial",
    standardCost: 6800,
    unitSalePrice: 10200,
    leadTime: 75,
    customFieldValues: exportData("EAR", "5A992.c", "US", "Yes", "Yes")
  },
  {
    readableId: "GNSS-CRPA-4",
    name: "CRPA Anti-Jam GNSS Antenna, 4-Element",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Serial",
    standardCost: 9800,
    unitSalePrice: 14700,
    leadTime: 90,
    description:
      "Null-steering antenna for GPS-contested operations. Single source.",
    customFieldValues: exportData("EAR", "7A994", "US", "Yes", "Yes")
  },
  {
    readableId: "GCS-100",
    name: "Ground Control Station, Rugged Tablet + Datalink",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Serial",
    standardCost: 38000,
    unitSalePrice: 57000,
    leadTime: 90,
    customFieldValues: exportData("ITAR", "USML VIII(h)(1)", "US", "Yes", "Yes")
  },
  {
    readableId: "CASE-200",
    name: "Rugged Transit Case Set (2 Air Vehicles)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 2600,
    unitSalePrice: 3900,
    leadTime: 30,
    customFieldValues: exportData("EAR99", "EAR99", "US", "Yes", "No")
  }
];

export const MATERIALS: ItemSpec[] = [
  {
    readableId: "MAT-AL7075-PLT",
    name: "Aluminum 7075-T651 Plate",
    type: "Material",
    trackingType: "Batch",
    standardCost: 12,
    unitOfMeasureCode: "LB",
    leadTime: 10
  },
  {
    readableId: "MAT-CF-PREPREG",
    name: "Carbon Fiber Prepreg T700/Epoxy, Ply Kit",
    type: "Material",
    standardCost: 320,
    unitOfMeasureCode: "EA",
    leadTime: 21,
    // Partially classified on purpose.
    material: {
      substance: "Carbon Fiber Composite",
      grade: "T700",
      finish: "Epoxy Resin System"
    }
  },
  {
    readableId: "MAT-EPDM-PAD",
    name: "EPDM Isolation Pad 25 x 25 mm",
    type: "Material",
    standardCost: 180,
    unitOfMeasureCode: "EA",
    leadTime: 45
  },
  {
    readableId: "MAT-KAPTON",
    name: "Kapton HN Tape 25mm",
    type: "Material",
    standardCost: 45,
    unitOfMeasureCode: "YD",
    leadTime: 7,
    material: {
      substance: "Polyimide Film",
      form: "Film Roll",
      materialType: "Polyimide Tape Roll",
      grade: "Kapton HN",
      finish: "Silicone Adhesive Backing",
      dimension: "25mm x 33m"
    }
  },
  {
    readableId: "MAT-POTTING-EP",
    name: "Two-Part Epoxy Potting Compound",
    type: "Material",
    standardCost: 95,
    unitOfMeasureCode: "LB",
    leadTime: 7
  },
  {
    readableId: "MAT-CONFCOAT",
    name: "Conformal Coat, Acrylic (IPC-CC-830) 400 mL",
    type: "Material",
    standardCost: 62,
    unitOfMeasureCode: "EA",
    leadTime: 5
  }
];

export const CONSUMABLES: ItemSpec[] = [
  {
    readableId: "CN-SEAL-KIT",
    name: "Environmental Seal & Gasket Kit (IP55)",
    type: "Consumable",
    standardCost: 380,
    leadTime: 14
  },
  {
    readableId: "CN-THREADLOCK",
    name: "Threadlocker, Medium Strength (MIL-S-46163)",
    type: "Consumable",
    standardCost: 95,
    unitOfMeasureCode: "LB"
  }
];

export const TOOLS: ItemSpec[] = [
  {
    readableId: "TL-TORQUE-J1",
    name: "Torque Driver Set (Metric)",
    type: "Tool",
    standardCost: 450
  },
  {
    readableId: "TL-COMPASS-FIX",
    name: "Compass & IMU Calibration Fixture",
    type: "Tool",
    standardCost: 2800
  }
];

export const SERVICES: ItemSpec[] = [
  {
    // A service's readableId is its name.
    readableId: "MIL-STD-810H Environmental Test",
    name: "MIL-STD-810H Environmental Test",
    type: "Service",
    thumbnail: "SVC-ENV",
    replenishment: "Buy",
    standardCost: 8500,
    leadTime: 30
  },
  {
    // Sold on the demo customer contract (sales.contracts); no bundled thumbnail.
    readableId: "Operator & Maintainer Training",
    name: "Operator & Maintainer Training",
    type: "Service",
    replenishment: "Buy",
    description:
      "Two-week operator and field-level maintainer course for up to 8 students, with course completion records.",
    standardCost: 32000
  },
  {
    // Sold on the demo customer contract (sales.contracts); no bundled thumbnail.
    readableId: "Field Service Representative Support",
    name: "Field Service Representative Support",
    type: "Service",
    replenishment: "Buy",
    description:
      "On-site field service representative for fielding and sustainment, billed per week.",
    standardCost: 9500
  }
];

// Make parts — BOM/BOP built programmatically in the tier
export const MAKE_PARTS: ItemSpec[] = [
  {
    readableId: "ISR4-AV",
    name: "ISR-4 Tactical Quadcopter, Air Vehicle",
    type: "Part",
    replenishment: "Make",
    // Serial-tracked: each air vehicle gets its own genealogy in traceability,
    // and its serial is the IUID on the data plate.
    trackingType: "Serial",
    standardCost: 118000,
    unitSalePrice: 195000,
    description:
      "Group 2 ISR quadcopter with EO/IR payload, mesh datalink and anti-jam GNSS.",
    customFieldValues: exportData(
      "ITAR",
      "USML VIII(a)(5) — SME",
      "US",
      "Yes",
      "Yes"
    )
  },
  {
    readableId: "AFR-100",
    name: "Airframe Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 6200,
    unitSalePrice: 11000,
    customFieldValues: IN_HOUSE_ITAR
  },
  {
    readableId: "BAT-700",
    name: "Power System Assembly (Dual Battery)",
    type: "Part",
    replenishment: "Make",
    standardCost: 7400,
    unitSalePrice: 13500,
    customFieldValues: IN_HOUSE_ITAR
  },
  {
    readableId: "BAT-TRAY-710",
    name: "Battery Tray, Composite",
    type: "Part",
    replenishment: "Make",
    standardCost: 650,
    unitSalePrice: 1200,
    customFieldValues: IN_HOUSE_ITAR
  },
  {
    readableId: "PCB-PDB-R1",
    name: "Power Distribution Board Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 780,
    unitSalePrice: 1400,
    customFieldValues: IN_HOUSE_ITAR
  },
  {
    readableId: "AVN-500",
    name: "Avionics Bay Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 24500,
    unitSalePrice: 42000,
    customFieldValues: exportData("ITAR", "USML VIII(h)(1)", "US", "Yes", "Yes")
  },
  {
    readableId: "PCB-FCB-R1",
    name: "Flight Control Carrier Board Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 920,
    unitSalePrice: 1650,
    customFieldValues: IN_HOUSE_ITAR
  },
  {
    readableId: "COM-800",
    name: "Comms & Navigation Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 21800,
    unitSalePrice: 36000,
    customFieldValues: exportData("ITAR", "USML VIII(h)(1)", "US", "Yes", "Yes")
  },
  {
    readableId: "ANT-BLADE-01",
    name: "MANET Blade Antenna, Composite Radome",
    type: "Part",
    replenishment: "Make",
    standardCost: 420,
    unitSalePrice: 780,
    customFieldValues: IN_HOUSE_ITAR
  },
  {
    readableId: "ARM-200",
    name: "Arm Set Assembly (4 Arms, Motors, Props)",
    type: "Part",
    replenishment: "Make",
    standardCost: 7600,
    unitSalePrice: 13800,
    customFieldValues: IN_HOUSE_ITAR
  },
  {
    readableId: "HRN-100",
    name: "Main Wiring Harness",
    type: "Part",
    replenishment: "Make",
    standardCost: 1850,
    unitSalePrice: 3400,
    customFieldValues: IN_HOUSE_ITAR
  },
  {
    readableId: "ISR4-SYS",
    name: "ISR-4 Tactical UAS System (2 AV + GCS)",
    type: "Part",
    replenishment: "Make",
    trackingType: "Serial",
    standardCost: 280000,
    unitSalePrice: 465000,
    description:
      "Fielded system: 2 air vehicles, ground control station, spares and transit cases.",
    customFieldValues: exportData(
      "ITAR",
      "USML VIII(a)(5) — SME",
      "US",
      "Yes",
      "Yes"
    )
  }
];

// BOMs and BOPs, in the order they are inserted.
// Fractional per-unit quantities are kept to halves, quarters and eighths.
// Extended quantity is float multiplication, so 0.05 x 3 renders as
// 0.15000000000000002 on the shop floor — these values multiply out clean.
export const METHODS: MakeMethodSpec[] = [
  {
    readableId: "AFR-100",
    bom: [
      { component: "MAT-AL7075-PLT", quantity: 4.5, order: 1 },
      { component: "FST-M3-TI", quantity: 48, order: 2 },
      { component: "FST-M5-A286", quantity: 24, order: 3 },
      { component: "ISO-DAMP-M3", quantity: 4, order: 4 },
      { component: "CN-THREADLOCK", quantity: 0.25, order: 5 }
    ],
    bop: [
      {
        process: "Machining",
        workCenter: "CNC Mill",
        description: "Machine hinge blocks and motor mounts",
        order: 1,
        setupTime: 0.75,
        laborTime: 4,
        machineTime: 3.5,
        parameters: [
          { key: "Fixture", value: "FX-AFR-HINGE-01" },
          { key: "Coolant", value: "Flood — water-soluble" }
        ]
      },
      {
        process: "Adhesive Bonding",
        workCenter: "Bonding & Cure Cell",
        description: "Bond frame plate inserts",
        order: 2,
        setupTime: 0.5,
        laborTime: 2
      },
      // Sent out to Redstone Precision for hard anodize between bonding and assembly.
      {
        process: "Outside Processing",
        description: "Hard anodize (Type III, MIL-A-8625) at supplier",
        order: 3,
        operationType: "Outside Processing",
        supplierProcess: "sp:Redstone Precision Machining:Outside Processing",
        operationLeadTime: 7,
        operationUnitCost: 240,
        laborTime: 0,
        laborUnit: "Total Hours"
      },
      {
        process: "UAS Integration",
        workCenter: "Integration Bay A",
        description: "Final assembly & torque",
        order: 4,
        laborTime: 3,
        // Gives the MES operation screen an Instructions tab with real steps.
        procedure: "procedure:Airframe Assembly",
        tools: [{ tool: "TL-TORQUE-J1", quantity: 1 }],
        parameters: [
          { key: "Torque Spec", value: "4.5 N·m, cross pattern" },
          { key: "Work Area", value: "ESD Protected Area (ANSI/ESD S20.20)" }
        ]
      }
    ]
  },
  {
    readableId: "BAT-TRAY-710",
    bom: [
      { component: "MAT-EPDM-PAD", quantity: 1, order: 1 },
      { component: "MAT-CF-PREPREG", quantity: 0.75, order: 2 },
      { component: "MAT-KAPTON", quantity: 2.5, order: 3 }
    ],
    bop: [
      {
        process: "Composite Layup",
        workCenter: "Integration Bay A",
        description: "Lay up battery tray (T700 prepreg, oven cure)",
        order: 1,
        setupTime: 0.5,
        laborTime: 6,
        machineTime: 4
      },
      {
        process: "UAS Integration",
        workCenter: "Integration Bay A",
        description: "Bond isolation pads and latch inserts",
        order: 2,
        laborTime: 8
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Dimensional and latch-fit inspection",
        order: 3,
        laborTime: 2
      }
    ]
  },
  {
    readableId: "PCB-PDB-R1",
    bom: [
      { component: "PCB-BARE-R3", quantity: 1, order: 1 },
      { component: "MAT-POTTING-EP", quantity: 0.25, order: 2 },
      { component: "MAT-CONFCOAT", quantity: 0.125, order: 3 }
    ],
    bop: [
      {
        process: "PCB Assembly",
        workCenter: "Avionics Lab",
        description: "SMT placement & reflow",
        order: 1,
        laborTime: 1.5
      },
      {
        process: "Potting & Conformal Coat",
        workCenter: "Potting Station",
        description: "Coat and pot",
        order: 2,
        laborTime: 0.5
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Flying probe test",
        order: 3,
        laborTime: 1,
        operationType: "Inspection",
        inspectionPlan: "PDB-PCB-FPT"
      }
    ]
  },
  {
    readableId: "PCB-FCB-R1",
    bom: [
      { component: "PCB-BARE-R3", quantity: 1, order: 1 },
      { component: "MAT-CONFCOAT", quantity: 0.125, order: 2 }
    ],
    bop: [
      {
        process: "PCB Assembly",
        workCenter: "Avionics Lab",
        description: "SMT placement & reflow",
        order: 1,
        setupTime: 0.5,
        laborTime: 1.5,
        machineTime: 0.25
      },
      {
        process: "Potting & Conformal Coat",
        workCenter: "Potting Station",
        description: "Conformal coat",
        order: 2,
        laborTime: 0.25
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Functional test",
        order: 3,
        laborTime: 1
      }
    ]
  },
  {
    readableId: "BAT-700",
    bom: [
      { component: "BAT-TRAY-710", quantity: 2, order: 1 },
      { component: "BAT-SMART-11AH", quantity: 2, order: 2 },
      { component: "PCB-PDB-R1", quantity: 1, order: 3 },
      { component: "MAT-KAPTON", quantity: 1.0, order: 4 }
    ],
    bop: [
      {
        process: "UAS Integration",
        workCenter: "Integration Bay A",
        description:
          "Install trays, power distribution board and battery packs",
        order: 1,
        laborTime: 4
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Power system load and balance test",
        order: 2,
        laborTime: 2
      }
    ]
  },
  {
    readableId: "AVN-500",
    bom: [
      { component: "ESC-80A-NDAA", quantity: 4, order: 1 },
      { component: "FC-NDAA-H7", quantity: 1, order: 2 },
      { component: "PCB-FCB-R1", quantity: 1, order: 3 },
      { component: "ISO-DAMP-M3", quantity: 8, order: 4 },
      { component: "FST-M3-TI", quantity: 24, order: 5 },
      { component: "MCU-EDGE-16", quantity: 1, order: 6 }
    ],
    bop: [
      {
        process: "UAS Integration",
        workCenter: "Integration Bay A",
        description: "Install flight controller, mission computer and ESCs",
        order: 1,
        laborTime: 5
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Avionics bench test (hardware-in-the-loop)",
        order: 2,
        laborTime: 3
      }
    ]
  },
  {
    readableId: "ANT-BLADE-01",
    bom: [
      { component: "MAT-CF-PREPREG", quantity: 0.125, order: 1 },
      { component: "MAT-KAPTON", quantity: 0.25, order: 2 }
    ],
    bop: [
      {
        process: "Composite Layup",
        workCenter: "Integration Bay A",
        description: "Lay up blade antenna radome",
        order: 1,
        laborTime: 2
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "VSWR and pattern check",
        order: 2,
        laborTime: 1
      }
    ]
  },
  {
    readableId: "COM-800",
    bom: [
      { component: "RDO-MESH-2X2", quantity: 1, order: 1 },
      { component: "ANT-BLADE-01", quantity: 2, order: 2 },
      { component: "MAT-KAPTON", quantity: 0.5, order: 3 },
      { component: "GNSS-CRPA-4", quantity: 1, order: 4 }
    ],
    bop: [
      {
        process: "UAS Integration",
        workCenter: "Integration Bay A",
        description: "Integrate mesh radio, CRPA antenna and blade antennas",
        order: 1,
        laborTime: 3
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Datalink range and GNSS anti-jam check",
        order: 2,
        laborTime: 2
      }
    ]
  },
  {
    readableId: "ARM-200",
    bom: [
      { component: "PRP-2270-CF", quantity: 2, order: 1 },
      { component: "ARM-CF-30", quantity: 4, order: 2 },
      { component: "MTR-4114-G1", quantity: 4, order: 3 },
      { component: "FST-M5-A286", quantity: 16, order: 4 }
    ],
    bop: [
      {
        process: "UAS Integration",
        workCenter: "Integration Bay A",
        description: "Assemble arms, motors and propellers",
        order: 1,
        laborTime: 6
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Motor run-in and vibration check",
        order: 2,
        laborTime: 4
      }
    ]
  },
  {
    readableId: "HRN-100",
    bom: [
      { component: "MAT-KAPTON", quantity: 5.0, order: 1 },
      { component: "FST-M3-TI", quantity: 12, order: 2 }
    ],
    bop: [
      {
        process: "UAS Integration",
        workCenter: "Integration Bay A",
        description: "Build and terminate harness (IPC/WHMA-A-620 Class 3)",
        order: 1,
        laborTime: 8
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Continuity and hipot test",
        order: 2,
        laborTime: 2
      }
    ]
  },
  {
    readableId: "ISR4-AV",
    bom: [
      { component: "AFR-100", quantity: 1, order: 1 },
      { component: "BAT-700", quantity: 1, order: 2 },
      { component: "AVN-500", quantity: 1, order: 3 },
      { component: "COM-800", quantity: 1, order: 4 },
      { component: "ARM-200", quantity: 1, order: 5 },
      { component: "HRN-100", quantity: 1, order: 6 },
      { component: "CN-SEAL-KIT", quantity: 1, order: 7 },
      { component: "GMB-EOIR-640", quantity: 1, order: 8 }
    ],
    bop: [
      // Assembly (not Process) so the MES routes this operation to the assembly
      // view, where tracked components are scanned into the serial being built.
      {
        process: "UAS Integration",
        workCenter: "Integration Bay A",
        description: "Integrate air vehicle",
        order: 1,
        laborTime: 16,
        operationType: "Assembly",
        // Gives the MES assembly view its step checklist.
        procedure: "procedure:Air Vehicle Integration"
      },
      {
        process: "MIL-STD-810H Environmental Test",
        workCenter: "Environmental Chamber 1",
        description: "Environmental stress screening (MIL-STD-810H)",
        order: 2,
        laborTime: 72,
        laborUnit: "Total Hours",
        procedure: "procedure:Environmental Stress Screening"
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Final inspection and tethered hover test",
        order: 3,
        laborTime: 4
      }
    ]
  },
  // The fielded system: two air vehicles kitted with the ground station,
  // spare batteries and props, and the transit cases.
  {
    readableId: "ISR4-SYS",
    bom: [
      { component: "ISR4-AV", quantity: 2, order: 1 },
      { component: "GCS-100", quantity: 1, order: 2 },
      { component: "CASE-200", quantity: 1, order: 3 },
      { component: "BAT-SMART-11AH", quantity: 4, order: 4 },
      { component: "PRP-2270-CF", quantity: 2, order: 5 }
    ],
    bop: [
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Kit the system and verify the packing list",
        order: 1,
        laborTime: 3
      }
    ]
  }
];

// Which supplier can supply what
export const SUPPLIER_LINKS: SupplierLinkSpec[] = [
  {
    supplier: "Vanguard Electronics Supply",
    item: "PCB-BARE-R3",
    price: 85,
    leadTime: 21
  },
  {
    supplier: "Vanguard Electronics Supply",
    item: "BAT-SMART-11AH",
    price: 1850,
    leadTime: 60
  },
  {
    supplier: "Vanguard Electronics Supply",
    item: "RDO-MESH-2X2",
    price: 9500,
    leadTime: 90
  },
  {
    supplier: "Vanguard Electronics Supply",
    item: "FC-NDAA-H7",
    price: 3200,
    leadTime: 60
  },
  {
    supplier: "Vanguard Electronics Supply",
    item: "MCU-EDGE-16",
    price: 6800,
    leadTime: 75
  },
  {
    supplier: "MilSpec Fastener Supply",
    item: "FST-M3-TI",
    price: 2.5,
    leadTime: 14
  },
  {
    supplier: "MilSpec Fastener Supply",
    item: "FST-M5-A286",
    price: 5.5,
    leadTime: 14
  },
  {
    supplier: "MilSpec Fastener Supply",
    item: "ISO-DAMP-M3",
    price: 18,
    leadTime: 10
  },
  {
    supplier: "Ridgeline Composites",
    item: "MAT-CF-PREPREG",
    price: 320,
    leadTime: 21
  },
  {
    supplier: "Ridgeline Composites",
    item: "MAT-AL7075-PLT",
    price: 12,
    leadTime: 10
  },
  {
    supplier: "Ridgeline Composites",
    item: "CASE-200",
    price: 2600,
    leadTime: 30
  },
  {
    supplier: "Sentry Propulsion Systems",
    item: "PRP-2270-CF",
    price: 340,
    leadTime: 30
  },
  {
    supplier: "Sentry Propulsion Systems",
    item: "ARM-CF-30",
    price: 420,
    leadTime: 45
  },
  {
    supplier: "Sentry Propulsion Systems",
    item: "MTR-4114-G1",
    price: 950,
    leadTime: 45
  },
  {
    supplier: "Meshline Tactical Systems",
    item: "ESC-80A-NDAA",
    price: 640,
    leadTime: 45
  },
  {
    supplier: "Meshline Tactical Systems",
    item: "GMB-EOIR-640",
    price: 28000,
    leadTime: 120
  },
  {
    supplier: "Meshline Tactical Systems",
    item: "GNSS-CRPA-4",
    price: 9800,
    leadTime: 90
  },
  {
    supplier: "Meshline Tactical Systems",
    item: "GCS-100",
    price: 38000,
    leadTime: 90
  },
  {
    supplier: "Sentry Propulsion Systems",
    item: "MTR-4114-G2",
    price: 1050,
    leadTime: 30
  }
];

// ARM-200 still names MTR-4114-G1 (8 on shelf A3-L2), so Consume First
// keeps pulling the Gen1 motor until the shelf is empty, then swaps to Gen2 —
// the US-magnet motor that clears the 2027 DFARS magnet rule.
export const SUPERSESSIONS: SupersessionSpec[] = [
  {
    predecessor: "MTR-4114-G1",
    successor: "MTR-4114-G2",
    mode: "Consume First",
    successorEffectivityOffset: -14
  }
];

// The Army office orders the air vehicle by its National Stock Number
// (FSC 1550, unmanned aircraft). Invented NIIN.
export const CUSTOMER_PARTS: CustomerPartSpec[] = [
  {
    item: "ISR4-AV",
    customer: "Army Small UAS Program Office",
    customerPartId: "1550-01-701-2244",
    customerRevision: "A"
  },
  {
    item: "BAT-700",
    customer: "Northgate Defense Systems",
    customerPartId: "NG-PWR-201"
  }
];

export const PRICE_OVERRIDES: PriceOverrideSpec[] = [
  {
    item: "ISR4-AV",
    customer: "Northgate Defense Systems",
    notes: "Block pricing per subcontract SC-2026-118, modification 3.",
    breaks: [
      { quantity: 1, overridePrice: 189000 },
      { quantity: 3, overridePrice: 182500 }
    ]
  }
];

export const PRICING_RULES: PricingRuleSpec[] = [
  {
    name: "Army program quantity discount",
    ruleType: "Discount",
    amountType: "Percentage",
    amount: 5,
    customer: "Army Small UAS Program Office",
    minQuantity: 2,
    priority: 10
  },
  {
    name: "Prime contractor spares markup",
    ruleType: "Markup",
    amountType: "Percentage",
    amount: 12,
    customerType: "Prime Contractor",
    items: ["RDO-MESH-2X2", "PRP-2270-CF", "ESC-80A-NDAA"],
    priority: 5
  },
  {
    name: "DFARS fastener lot break",
    ruleType: "Discount",
    amountType: "Fixed",
    amount: 0.25,
    items: ["FST-M3-TI", "FST-M5-A286"],
    minQuantity: 250,
    priority: 1
  }
];

export const CONFIGURATION: ConfigurationSpec = {
  item: "ISR4-AV",
  group: "Mission Configuration",
  parameters: [
    {
      key: "endurance_target_min",
      label: "Endurance Target (min)",
      dataType: "numeric"
    },
    {
      key: "datalink_band",
      label: "Datalink Band",
      dataType: "list",
      listOptions: ["L-Band", "S-Band", "Dual-Band"]
    },
    {
      key: "eoir_payload",
      label: "Include EO/IR Gimbal",
      dataType: "boolean"
    }
  ],
  rules: [
    {
      target: { component: "GMB-EOIR-640" },
      field: "quantity",
      code: "return params.eoir_payload ? 1 : 0;"
    },
    {
      target: { operation: 2 },
      field: "laborTime",
      code: 'return params.datalink_band === "Dual-Band" ? 96 : 72;'
    }
  ],
  prices: [
    { key: "endurance_target_min", amount: 100 },
    { key: "datalink_band", value: "L-Band", amount: 2000 },
    { key: "datalink_band", value: "S-Band", amount: 3000 },
    { key: "datalink_band", value: "Dual-Band", amount: 4000 },
    { key: "eoir_payload", value: "true", amount: 1000 }
  ]
};

export const REVISION_LADDER: RevisionLadderSpec[] = [
  {
    item: "ANT-BLADE-01",
    obsoleteRevision: "A",
    nextRevision: "B",
    nextStatus: "Prototype"
  }
];

// A sampling plan of its own makes the MES open an inspection lot, not a plain operation.
export const INSPECTION_PLANS: InspectionPlanSpec[] = [
  {
    key: "PDB-PCB-FPT",
    item: "PCB-PDB-R1",
    drawingNumber: "HUS-PDB-200 Rev D",
    aql: 1.0,
    features: [
      {
        label: "1",
        description: "5V servo rail regulation under 3 A load",
        nominalValue: "5.000",
        tolerancePlus: "0.100",
        toleranceMinus: "0.100",
        unit: "V"
      },
      {
        label: "2",
        description: "Battery balance FET gate threshold",
        nominalValue: "2.10",
        tolerancePlus: "0.25",
        toleranceMinus: "0.25",
        unit: "V"
      }
    ]
  }
];

export const ENFORCEMENT_RULES: EnforcementRuleSpec[] = [
  {
    family: "sales",
    name: "ITAR UAS — US ship-to only",
    description:
      "22 CFR 120: the ISR-4 system, air vehicle and EO/IR gimbal are defense articles.",
    message:
      "ITAR-controlled hardware can only ship to a US address. A foreign sale needs a DSP-5 export license — route it through Trade Compliance.",
    severity: "error",
    surfaces: ["salesOrderLine", "salesInvoiceLine"],
    match: "all",
    conditions: [
      { field: "customer.location.countryCode", op: "in", value: ["US"] }
    ],
    items: ["ISR4-SYS", "ISR4-AV", "GMB-EOIR-640"]
  },
  {
    family: "sales",
    name: "Special Operations orders need program sign-off",
    message:
      "Mission subsystems quoted to Special Operations need program office sign-off before pricing is released.",
    severity: "warn",
    surfaces: ["quoteLine", "salesOrderLine"],
    match: "all",
    conditions: [
      {
        field: "customer.customerTypeId",
        op: "notIn",
        value: { customerTypes: ["Special Operations"] }
      }
    ],
    items: ["BAT-700", "COM-800"]
  },
  {
    family: "storage",
    targetType: "item",
    name: "Flight electronics stay at the plant",
    message:
      "Flight electronics are stored at the Huntsville plant only — pick a plant bin.",
    severity: "warn",
    surfaces: ["receipt", "stockTransfer"],
    match: "all",
    conditions: [
      {
        field: "storageUnit.locationId",
        op: "eq",
        value: { location: "Plant" }
      }
    ],
    items: ["RDO-MESH-2X2", "GMB-EOIR-640", "ESC-80A-NDAA"]
  },
  {
    family: "storage",
    targetType: "item",
    name: "Carbon arms on racks",
    message: "Folding carbon arms are racked, never binned.",
    severity: "warn",
    surfaces: ["place"],
    match: "all",
    conditions: [
      {
        field: "storageUnit.storageTypeId",
        op: "eq",
        value: { storageType: "Rack" }
      }
    ],
    items: ["ARM-CF-30"]
  },
  {
    family: "storage",
    targetType: "workCenter",
    name: "Integration bay in service",
    message:
      "This integration bay is out of service — start the integration on another bay.",
    severity: "error",
    surfaces: ["operationStart"],
    match: "all",
    conditions: [{ field: "workCenter.active", op: "eq", value: true }],
    workCenters: ["Integration Bay A"]
  }
];

export const BATCH_PROPERTIES: BatchPropertySpec[] = [
  { item: "BAT-SMART-11AH", label: "Cell lot code", dataType: "text" },
  { item: "BAT-SMART-11AH", label: "Formation date", dataType: "date" },
  {
    item: "BAT-SMART-11AH",
    label: "Capacity grade",
    dataType: "list",
    listOptions: ["A", "B"]
  },
  { item: "MAT-AL7075-PLT", label: "Heat number", dataType: "text" },
  { item: "MAT-AL7075-PLT", label: "Mill cert received", dataType: "boolean" },
  {
    item: "MAT-AL7075-PLT",
    label: "Melt country (DFARS 252.225-7009)",
    dataType: "text"
  }
];

export const defenseItems: ItemsData = {
  assembly: defenseAssembly,
  buyParts: BUY_PARTS,
  materials: MATERIALS,
  consumables: CONSUMABLES,
  tools: TOOLS,
  services: SERVICES,
  makeParts: MAKE_PARTS,
  methods: METHODS,
  supplierLinks: SUPPLIER_LINKS,
  supersessions: SUPERSESSIONS,
  customerParts: CUSTOMER_PARTS,
  priceOverrides: PRICE_OVERRIDES,
  pricingRules: PRICING_RULES,
  configuration: CONFIGURATION,
  revisionLadder: REVISION_LADDER,
  inspectionPlans: INSPECTION_PLANS,
  enforcementRules: ENFORCEMENT_RULES,
  batchProperties: BATCH_PROPERTIES
};
