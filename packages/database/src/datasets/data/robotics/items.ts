import type { ItemSpec } from "../../helpers/items.ts";
import type {
  ItemsData,
  MakeMethodSpec,
  SupplierLinkSpec
} from "../../types.ts";

// ---------------------------------------------------------------------------
// Robot item catalog for Helix Robotics Inc.
// Namespace items by type so readableIds can't collide across extension tables.
//   ROB- / ARM- / CTRL- / GRP- / HRN- = Make Parts (Part type)
//   PCB- = Bare boards (buy) and board assemblies (make)
//   DRV- = Servo drive (buy) and drive module (make)
//   MOT- / GBX- / ENC- / SNS- / BRG- / FST- = Buy Parts
//   MAT- = Materials
//   TL-  = Tools
//   SVC- = Services
//   CN-  = Consumables
// ---------------------------------------------------------------------------

export const BUY_PARTS: ItemSpec[] = [
  // Motion
  {
    readableId: "MOT-AC-750W",
    name: "AC Servo Motor 750W 3000rpm",
    type: "Part",
    replenishment: "Buy",
    // Serial-tracked: the motor serial is what gets scanned into a joint on the
    // floor, and it is what a warranty claim is argued over.
    trackingType: "Serial",
    standardCost: 640,
    unitSalePrice: 960,
    leadTime: 45
  },
  {
    readableId: "MOT-AC-200W",
    name: "AC Servo Motor 200W 3000rpm",
    type: "Part",
    replenishment: "Buy",
    standardCost: 310,
    unitSalePrice: 465,
    leadTime: 45
  },
  {
    readableId: "GBX-HD-80",
    name: "Harmonic Gear Set 80mm 100:1",
    type: "Part",
    replenishment: "Buy",
    standardCost: 1150,
    unitSalePrice: 1725,
    leadTime: 60
  },
  {
    readableId: "GBX-HD-50",
    name: "Harmonic Gear Set 50mm 80:1",
    type: "Part",
    replenishment: "Buy",
    standardCost: 780,
    unitSalePrice: 1170,
    leadTime: 60
  },
  {
    readableId: "ENC-ABS-19",
    name: "Absolute Encoder 19-bit Single-Turn",
    type: "Part",
    replenishment: "Buy",
    // Batch-tracked: receiving captures the lot, and the lot is what a firmware
    // recall from the encoder vendor is scoped to.
    trackingType: "Batch",
    standardCost: 240,
    unitSalePrice: 360,
    leadTime: 30
  },
  // Controls
  {
    readableId: "DRV-SRV-400",
    name: "Servo Drive 400W EtherCAT",
    type: "Part",
    replenishment: "Buy",
    standardCost: 420,
    unitSalePrice: 630,
    leadTime: 45
  },
  {
    readableId: "PCB-BARE-4L",
    name: "Bare PCB 4-Layer 160x100mm",
    type: "Part",
    replenishment: "Buy",
    standardCost: 22,
    leadTime: 21
  },
  {
    readableId: "SNS-FT-6AX",
    name: "Six-Axis Force/Torque Sensor 200N",
    type: "Part",
    replenishment: "Buy",
    standardCost: 3400,
    unitSalePrice: 5100,
    leadTime: 75
  },
  // Mechanical hardware
  {
    readableId: "BRG-CRB-100",
    name: "Crossed Roller Bearing 100mm Bore",
    type: "Part",
    replenishment: "Buy",
    standardCost: 185,
    unitSalePrice: 278,
    leadTime: 30
  },
  {
    readableId: "FST-M8-SS",
    name: "M8 x 25 Socket Head Cap Screw (A4)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 0.85,
    unitSalePrice: 1.4,
    leadTime: 10
  },
  {
    readableId: "FST-M5-SS",
    name: "M5 x 16 Socket Head Cap Screw (A4)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 0.55,
    unitSalePrice: 0.9,
    leadTime: 10
  }
];

export const MATERIALS: ItemSpec[] = [
  {
    readableId: "MAT-AL6061-BIL",
    name: "Aluminum 6061-T6 Billet",
    type: "Material",
    trackingType: "Batch",
    standardCost: 4.2,
    unitOfMeasureCode: "LB",
    leadTime: 10
  },
  {
    readableId: "MAT-STEEL-SHT",
    name: "Cold-Rolled Steel Sheet 2mm",
    type: "Material",
    standardCost: 1.9,
    unitOfMeasureCode: "LB",
    leadTime: 14
  },
  {
    readableId: "MAT-CBL-16AWG",
    name: "Shielded Servo Cable 16 AWG",
    type: "Material",
    standardCost: 2.4,
    unitOfMeasureCode: "FOOT",
    leadTime: 14
  },
  {
    readableId: "MAT-CONN-M23",
    name: "M23 Circular Connector Kit",
    type: "Material",
    standardCost: 38,
    unitOfMeasureCode: "EA",
    leadTime: 21
  },
  {
    readableId: "MAT-SOLDER-PST",
    name: "Solder Paste SAC305 500g Jar",
    type: "Material",
    standardCost: 78,
    unitOfMeasureCode: "EA",
    leadTime: 7
  },
  {
    readableId: "MAT-COAT-UV",
    name: "UV-Cure Conformal Coating 1L",
    type: "Material",
    standardCost: 96,
    unitOfMeasureCode: "EA",
    leadTime: 10
  }
];

export const CONSUMABLES: ItemSpec[] = [
  {
    readableId: "CN-COVER-KIT",
    name: "Arm Protective Cover Kit",
    type: "Consumable",
    standardCost: 210,
    leadTime: 14
  },
  {
    readableId: "CN-GREASE-EP",
    name: "EP Robot Gear Grease",
    type: "Consumable",
    standardCost: 42,
    unitOfMeasureCode: "LB"
  }
];

export const TOOLS: ItemSpec[] = [
  {
    readableId: "TL-TORQUE-M1",
    name: "Torque Wrench Set (Metric)",
    type: "Tool",
    standardCost: 380
  },
  {
    readableId: "TL-BACKLASH-J1",
    name: "Joint Backlash Test Fixture",
    type: "Tool",
    standardCost: 2150
  }
];

export const SERVICES: ItemSpec[] = [
  {
    readableId: "SVC-CAL",
    name: "Robot Calibration & Certification (external)",
    type: "Service",
    replenishment: "Buy",
    standardCost: 1850,
    leadTime: 21
  }
];

// Make parts — BOM/BOP built programmatically in the tier
export const MAKE_PARTS: ItemSpec[] = [
  {
    readableId: "ROB-2000",
    name: "Vertex 10 Six-Axis Robot Arm (Complete)",
    type: "Part",
    replenishment: "Make",
    // Serial-tracked: each arm gets its own genealogy in traceability.
    trackingType: "Serial",
    standardCost: 0,
    unitSalePrice: 58000
  },
  {
    readableId: "ARM-BASE-001",
    name: "Base & Column Assembly (J1)",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 6800
  },
  {
    readableId: "ARM-LINK-001",
    name: "Upper & Lower Link Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 12400
  },
  {
    readableId: "DRV-J2-MOD",
    name: "Joint Drive Module (J2/J3)",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 3900
  },
  {
    readableId: "ARM-WRIST-001",
    name: "Three-Axis Wrist Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 9600
  },
  {
    readableId: "CTRL-100",
    name: "Robot Controller Cabinet",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 11500
  },
  {
    readableId: "PCB-CTRL-R1",
    name: "Motion Control PCB Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 980
  },
  {
    readableId: "PCB-IO-R1",
    name: "Safety I/O Board Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 620
  },
  {
    readableId: "HRN-ARM-001",
    name: "Arm Cable Harness",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 1400
  },
  {
    readableId: "GRP-2F-80",
    name: "Two-Finger Parallel Gripper 80mm",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 6900
  },
  {
    readableId: "GRP-JAW-80",
    name: "Gripper Jaw Set 80mm",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 320
  }
];

// BOMs and BOPs, in the order they are inserted — components before the
// assemblies that consume them.
// Fractional per-unit quantities are kept to halves, quarters and eighths.
// Extended quantity is float multiplication, so 0.05 x 3 renders as
// 0.15000000000000002 on the shop floor — these values multiply out clean.
export const METHODS: MakeMethodSpec[] = [
  {
    readableId: "ARM-BASE-001",
    bom: [
      { component: "MAT-AL6061-BIL", quantity: 22, order: 1 },
      { component: "MOT-AC-750W", quantity: 1, order: 2 },
      { component: "GBX-HD-80", quantity: 1, order: 3 },
      { component: "FST-M8-SS", quantity: 24, order: 4 },
      { component: "CN-GREASE-EP", quantity: 0.25, order: 5 }
    ],
    bop: [
      {
        process: "CNC Machining",
        workCenter: "CNC Mill Cell",
        description: "Machine base casting and column",
        order: 1,
        laborTime: 4
      },
      {
        process: "Sheet Metal Fabrication",
        workCenter: "CNC Mill Cell",
        description: "Form and weld base cover panels",
        order: 2,
        laborTime: 1.5
      },
      // Sent out to Kappa for hard anodize between machining and assembly.
      {
        process: "Outside Processing",
        description: "Hard anodize (Type III) at supplier",
        order: 3,
        operationType: "Outside Processing",
        supplierProcess: "sp:Kappa Contract Machining:Outside Processing",
        operationLeadTime: 7,
        operationUnitCost: 180,
        laborTime: 0,
        laborUnit: "Total Hours"
      },
      {
        process: "Gearbox Assembly",
        workCenter: "Gearbox Bench",
        description: "Install J1 gear set, motor & torque",
        order: 4,
        laborTime: 3,
        // Gives the MES operation screen an Instructions tab with real steps.
        procedure: "procedure:Arm Base Assembly"
      }
    ]
  },
  {
    readableId: "DRV-J2-MOD",
    bom: [
      { component: "MOT-AC-750W", quantity: 1, order: 1 },
      { component: "GBX-HD-80", quantity: 1, order: 2 },
      { component: "ENC-ABS-19", quantity: 1, order: 3 }
    ],
    bop: [
      {
        process: "Gearbox Assembly",
        workCenter: "Gearbox Bench",
        description: "Press harmonic gear set and lubricate",
        order: 1,
        laborTime: 2
      },
      {
        process: "Gearbox Assembly",
        workCenter: "Gearbox Bench",
        description: "Mate servo motor and absolute encoder",
        order: 2,
        laborTime: 1.5
      },
      {
        process: "Final Inspection",
        workCenter: "Inspection Bench",
        description: "Backlash and holding torque test",
        order: 3,
        laborTime: 1
      }
    ]
  },
  {
    readableId: "PCB-CTRL-R1",
    bom: [
      { component: "PCB-BARE-4L", quantity: 1, order: 1 },
      { component: "MAT-SOLDER-PST", quantity: 0.25, order: 2 },
      { component: "MAT-CONN-M23", quantity: 2, order: 3 }
    ],
    bop: [
      {
        process: "PCB Assembly",
        workCenter: "SMT Line",
        description: "SMT placement & reflow",
        order: 1,
        laborTime: 1.5
      },
      {
        process: "PCB Assembly",
        workCenter: "SMT Line",
        description: "Hand-solder connectors and inspect joints",
        order: 2,
        laborTime: 0.5
      },
      {
        process: "Final Inspection",
        workCenter: "Inspection Bench",
        description: "Flying probe test",
        order: 3,
        laborTime: 1
      }
    ]
  },
  {
    readableId: "PCB-IO-R1",
    bom: [
      { component: "PCB-BARE-4L", quantity: 1, order: 1 },
      { component: "MAT-SOLDER-PST", quantity: 0.125, order: 2 },
      { component: "MAT-COAT-UV", quantity: 0.125, order: 3 }
    ],
    bop: [
      {
        process: "PCB Assembly",
        workCenter: "SMT Line",
        description: "SMT placement & reflow",
        order: 1,
        laborTime: 1.5
      },
      {
        process: "PCB Assembly",
        workCenter: "SMT Line",
        description: "Conformal coat and UV cure",
        order: 2,
        laborTime: 0.25
      },
      {
        process: "Final Inspection",
        workCenter: "Inspection Bench",
        description: "Safety circuit functional test",
        order: 3,
        laborTime: 1
      }
    ]
  },
  {
    readableId: "ARM-LINK-001",
    bom: [
      { component: "DRV-J2-MOD", quantity: 2, order: 1 },
      { component: "MAT-AL6061-BIL", quantity: 14, order: 2 },
      { component: "BRG-CRB-100", quantity: 2, order: 3 }
    ],
    bop: [
      {
        process: "Gearbox Assembly",
        workCenter: "Gearbox Bench",
        description: "Install J2/J3 drive modules into links",
        order: 1,
        laborTime: 4
      },
      {
        process: "Final Inspection",
        workCenter: "Inspection Bench",
        description: "Link travel and backlash check",
        order: 2,
        laborTime: 2
      }
    ]
  },
  {
    readableId: "ARM-WRIST-001",
    bom: [
      { component: "MOT-AC-200W", quantity: 3, order: 1 },
      { component: "GBX-HD-50", quantity: 3, order: 2 },
      { component: "ENC-ABS-19", quantity: 3, order: 3 },
      { component: "BRG-CRB-100", quantity: 6, order: 4 }
    ],
    bop: [
      {
        process: "Gearbox Assembly",
        workCenter: "Gearbox Bench",
        description: "Build J4/J5/J6 wrist stack",
        order: 1,
        laborTime: 5
      },
      {
        process: "Final Inspection",
        workCenter: "Inspection Bench",
        description: "Wrist axis functional test",
        order: 2,
        laborTime: 3
      }
    ]
  },
  {
    readableId: "GRP-JAW-80",
    bom: [
      { component: "MAT-AL6061-BIL", quantity: 1.5, order: 1 },
      { component: "FST-M5-SS", quantity: 8, order: 2 }
    ],
    bop: [
      {
        process: "CNC Machining",
        workCenter: "CNC Mill Cell",
        description: "Machine jaw pair and dowel features",
        order: 1,
        laborTime: 1.25
      },
      {
        process: "Final Inspection",
        workCenter: "Inspection Bench",
        description: "Jaw parallelism check",
        order: 2,
        laborTime: 0.5
      }
    ]
  },
  {
    readableId: "GRP-2F-80",
    bom: [
      { component: "MOT-AC-200W", quantity: 1, order: 1 },
      { component: "GRP-JAW-80", quantity: 2, order: 2 },
      { component: "SNS-FT-6AX", quantity: 1, order: 3 },
      { component: "MAT-AL6061-BIL", quantity: 3, order: 4 }
    ],
    bop: [
      {
        process: "Gearbox Assembly",
        workCenter: "Gearbox Bench",
        description: "Assemble gripper drive and jaws",
        order: 1,
        laborTime: 3
      },
      {
        process: "Final Inspection",
        workCenter: "Inspection Bench",
        description: "Grip force and repeatability test",
        order: 2,
        laborTime: 1.5
      }
    ]
  },
  {
    readableId: "CTRL-100",
    bom: [
      { component: "DRV-SRV-400", quantity: 6, order: 1 },
      { component: "PCB-CTRL-R1", quantity: 1, order: 2 },
      { component: "PCB-IO-R1", quantity: 2, order: 3 },
      { component: "MAT-STEEL-SHT", quantity: 12, order: 4 }
    ],
    bop: [
      {
        process: "Sheet Metal Fabrication",
        workCenter: "CNC Mill Cell",
        description: "Form and rivet cabinet enclosure",
        order: 1,
        laborTime: 2
      },
      {
        process: "Harness Build",
        workCenter: "Harness Bench",
        description: "Mount drives, boards and wire the backplane",
        order: 2,
        laborTime: 5
      }
    ]
  },
  {
    readableId: "HRN-ARM-001",
    bom: [
      { component: "MAT-CBL-16AWG", quantity: 32, order: 1 },
      { component: "MAT-CONN-M23", quantity: 6, order: 2 }
    ],
    bop: [
      {
        process: "Harness Build",
        workCenter: "Harness Bench",
        description: "Cut, crimp and terminate harness",
        order: 1,
        laborTime: 6
      },
      {
        process: "Final Inspection",
        workCenter: "Inspection Bench",
        description: "Continuity & hipot test",
        order: 2,
        laborTime: 2
      }
    ]
  },
  {
    readableId: "ROB-2000",
    bom: [
      { component: "ARM-BASE-001", quantity: 1, order: 1 },
      { component: "ARM-LINK-001", quantity: 1, order: 2 },
      { component: "ARM-WRIST-001", quantity: 1, order: 3 },
      { component: "CTRL-100", quantity: 1, order: 4 },
      { component: "HRN-ARM-001", quantity: 1, order: 5 },
      { component: "GRP-2F-80", quantity: 1, order: 6 },
      { component: "CN-COVER-KIT", quantity: 1, order: 7 }
    ],
    bop: [
      // Assembly (not Process) so the MES routes this operation to the assembly
      // view, where tracked components are scanned into the serial being built.
      {
        process: "Robot Integration",
        workCenter: "Integration Cell 1",
        description: "Arm and controller integration",
        order: 1,
        laborTime: 16,
        operationType: "Assembly",
        // Gives the MES assembly view its step checklist.
        procedure: "procedure:Robot Cell Integration"
      },
      {
        process: "Burn-In Test",
        workCenter: "Burn-In Rack",
        description: "24-hour burn-in and repeatability check",
        order: 2,
        laborTime: 24,
        laborUnit: "Total Hours",
        procedure: "procedure:Burn-In Qualification Test"
      },
      {
        process: "Final Inspection",
        workCenter: "Inspection Bench",
        description: "Acceptance test review",
        order: 3,
        laborTime: 4
      }
    ]
  }
];

// Which supplier can supply what
export const SUPPLIER_LINKS: SupplierLinkSpec[] = [
  {
    supplier: "Kestrel Motion",
    item: "MOT-AC-750W",
    price: 640,
    leadTime: 45
  },
  {
    supplier: "Kestrel Motion",
    item: "MOT-AC-200W",
    price: 310,
    leadTime: 45
  },
  {
    supplier: "Kestrel Motion",
    item: "DRV-SRV-400",
    price: 420,
    leadTime: 45
  },
  {
    supplier: "Torqline Gearing",
    item: "GBX-HD-80",
    price: 1150,
    leadTime: 60
  },
  {
    supplier: "Torqline Gearing",
    item: "GBX-HD-50",
    price: 780,
    leadTime: 60
  },
  {
    supplier: "Torqline Gearing",
    item: "BRG-CRB-100",
    price: 185,
    leadTime: 30
  },
  {
    supplier: "Northgate Electronics",
    item: "PCB-BARE-4L",
    price: 22,
    leadTime: 21
  },
  {
    supplier: "Northgate Electronics",
    item: "ENC-ABS-19",
    price: 240,
    leadTime: 30
  },
  {
    supplier: "Northgate Electronics",
    item: "SNS-FT-6AX",
    price: 3400,
    leadTime: 75
  },
  {
    supplier: "Ironbark Metals",
    item: "MAT-AL6061-BIL",
    price: 4.2,
    leadTime: 10
  },
  {
    supplier: "Ironbark Metals",
    item: "MAT-STEEL-SHT",
    price: 1.9,
    leadTime: 14
  },
  {
    supplier: "Precision Fasteners Co",
    item: "FST-M8-SS",
    price: 0.85,
    leadTime: 10
  },
  {
    supplier: "Precision Fasteners Co",
    item: "FST-M5-SS",
    price: 0.55,
    leadTime: 10
  }
];

export const roboticsItems: ItemsData = {
  buyParts: BUY_PARTS,
  materials: MATERIALS,
  consumables: CONSUMABLES,
  tools: TOOLS,
  services: SERVICES,
  makeParts: MAKE_PARTS,
  methods: METHODS,
  supplierLinks: SUPPLIER_LINKS
};
