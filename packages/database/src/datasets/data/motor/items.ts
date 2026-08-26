import type { ItemSpec } from "../../helpers/items.ts";
import type {
  ItemsData,
  MakeMethodSpec,
  SupplierLinkSpec
} from "../../types.ts";

// ---------------------------------------------------------------------------
// Motor item catalog for Torque Dynamics LLC.
// Namespace items by type so readableIds can't collide across extension tables.
//   MTR- / STA- / ROT- / HSG- / SHF- / COIL- / LAM-STK- = Make Parts
//   MAG- / BRG- / ENC- / TRM-BLK / FAN- / SEAL- / FST- / NPL- = Buy Parts
//   MAT- = Materials
//   TL-  = Tools
//   SVC- = Services
//   CN-  = Consumables
// ---------------------------------------------------------------------------

export const BUY_PARTS: ItemSpec[] = [
  // Magnets
  {
    readableId: "MAG-NDFB-45",
    name: "NdFeB Magnet Segment N45SH",
    type: "Part",
    replenishment: "Buy",
    // Batch-tracked: a demagnetization or coating complaint is argued lot by lot,
    // and the mill certificate arrives against the lot, not the piece.
    trackingType: "Batch",
    standardCost: 18.5,
    unitSalePrice: 28,
    leadTime: 60
  },
  {
    readableId: "MAG-NDFB-38",
    name: "NdFeB Magnet Segment N38UH",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Batch",
    standardCost: 14.2,
    unitSalePrice: 21.5,
    leadTime: 60
  },
  // Bearings and seals
  {
    readableId: "BRG-6206-C3",
    name: "Deep Groove Ball Bearing 6206 C3",
    type: "Part",
    replenishment: "Buy",
    standardCost: 12.4,
    unitSalePrice: 19,
    leadTime: 21
  },
  {
    readableId: "BRG-6308-C3",
    name: "Deep Groove Ball Bearing 6308 C3",
    type: "Part",
    replenishment: "Buy",
    standardCost: 26.8,
    unitSalePrice: 41,
    leadTime: 21
  },
  {
    readableId: "SEAL-VR-45",
    name: "V-Ring Shaft Seal 45mm",
    type: "Part",
    replenishment: "Buy",
    standardCost: 3.6,
    unitSalePrice: 6,
    leadTime: 14
  },
  // Electrical
  {
    readableId: "ENC-INC-2048",
    name: "Incremental Encoder 2048 PPR",
    type: "Part",
    replenishment: "Buy",
    // Serial-tracked: the encoder serial is scanned into the motor it feeds back
    // for, and it is what a field replacement is matched against.
    trackingType: "Serial",
    standardCost: 96,
    unitSalePrice: 145,
    leadTime: 35
  },
  {
    readableId: "TRM-BLK-6P",
    name: "Six-Pole Terminal Block 600V",
    type: "Part",
    replenishment: "Buy",
    standardCost: 8.9,
    unitSalePrice: 14,
    leadTime: 14
  },
  {
    readableId: "FAN-AX-160",
    name: "Axial Cooling Fan 160mm",
    type: "Part",
    replenishment: "Buy",
    standardCost: 34,
    unitSalePrice: 52,
    leadTime: 21
  },
  // Hardware
  {
    readableId: "FST-M6-SS",
    name: "M6 x 20 Socket Head Cap Screw (A2)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 0.42,
    unitSalePrice: 0.75,
    leadTime: 10
  },
  {
    readableId: "FST-M10-SS",
    name: "M10 x 35 Hex Head Bolt (A2)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 1.15,
    unitSalePrice: 1.9,
    leadTime: 10
  },
  {
    readableId: "NPL-SS-STD",
    name: "Stainless Motor Nameplate Blank",
    type: "Part",
    replenishment: "Buy",
    standardCost: 2.25,
    unitSalePrice: 3.8,
    leadTime: 12
  }
];

export const MATERIALS: ItemSpec[] = [
  {
    readableId: "MAT-LAM-M19",
    name: "Electrical Steel Lamination Strip M19 0.35mm",
    type: "Material",
    trackingType: "Batch",
    standardCost: 1.85,
    unitOfMeasureCode: "LB",
    leadTime: 28
  },
  {
    readableId: "MAT-CU-18AWG",
    name: "Enameled Copper Magnet Wire 18 AWG",
    type: "Material",
    // Batch-tracked: a winding failure is traced back to the wire spool lot.
    trackingType: "Batch",
    standardCost: 6.4,
    unitOfMeasureCode: "LB",
    leadTime: 21
  },
  {
    readableId: "MAT-INS-NOMEX",
    name: "Nomex 410 Slot Insulation Paper",
    type: "Material",
    standardCost: 12.5,
    unitOfMeasureCode: "LB",
    leadTime: 21
  },
  {
    readableId: "MAT-VARNISH",
    name: "Class H Impregnation Varnish",
    type: "Material",
    standardCost: 84,
    unitOfMeasureCode: "GL",
    leadTime: 14
  },
  {
    readableId: "MAT-AL6061-BAR",
    name: "Aluminum 6061-T6 Round Bar",
    type: "Material",
    standardCost: 3.9,
    unitOfMeasureCode: "LB",
    leadTime: 10
  },
  {
    readableId: "MAT-STL-4140",
    name: "4140 Alloy Steel Shaft Bar",
    type: "Material",
    standardCost: 2.7,
    unitOfMeasureCode: "LB",
    leadTime: 14
  }
];

export const CONSUMABLES: ItemSpec[] = [
  {
    readableId: "CN-EPOXY-MAG",
    name: "Magnet Bonding Epoxy Kit",
    type: "Consumable",
    standardCost: 128,
    leadTime: 14
  },
  {
    readableId: "CN-BRG-GREASE",
    name: "High-Temp Bearing Grease",
    type: "Consumable",
    standardCost: 38,
    unitOfMeasureCode: "LB"
  }
];

export const TOOLS: ItemSpec[] = [
  {
    readableId: "TL-ARBOR-PRESS",
    name: "Rotor Arbor Press Fixture",
    type: "Tool",
    standardCost: 4200
  },
  {
    readableId: "TL-BAL-MANDREL",
    name: "Balancing Mandrel Set",
    type: "Tool",
    standardCost: 1850
  }
];

export const SERVICES: ItemSpec[] = [
  {
    readableId: "SVC-DYNO-CERT",
    name: "Dynamometer Certification (external)",
    type: "Service",
    replenishment: "Buy",
    standardCost: 1450,
    leadTime: 21
  }
];

// Make parts — BOM/BOP built programmatically in the tier
export const MAKE_PARTS: ItemSpec[] = [
  {
    readableId: "MTR-9000",
    name: "TD-9000 Servo Motor Assembly (Complete)",
    type: "Part",
    replenishment: "Make",
    // Serial-tracked: every finished motor gets its own genealogy and nameplate.
    trackingType: "Serial",
    standardCost: 0,
    unitSalePrice: 4850
  },
  {
    readableId: "MTR-4500",
    name: "TD-4500 Servo Motor Assembly (Complete)",
    type: "Part",
    replenishment: "Make",
    trackingType: "Serial",
    standardCost: 0,
    unitSalePrice: 2950
  },
  {
    readableId: "STA-9000",
    name: "Stator Assembly (9000 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 1180
  },
  {
    readableId: "STA-4500",
    name: "Stator Assembly (4500 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 780
  },
  {
    readableId: "ROT-9000",
    name: "Rotor Assembly (9000 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 1420
  },
  {
    readableId: "HSG-9000",
    name: "Motor Housing & End Bells (9000 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 640
  },
  {
    readableId: "SHF-9000",
    name: "Precision Motor Shaft (9000 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 210
  },
  {
    readableId: "COIL-9000",
    name: "Wound Coil Set (9000 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 480
  },
  {
    readableId: "LAM-STK-STA",
    name: "Stator Lamination Stack",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 260
  },
  {
    readableId: "LAM-STK-ROT",
    name: "Rotor Lamination Stack",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 190
  },
  {
    readableId: "TRM-BOX-9000",
    name: "Terminal Box Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 165
  }
];

// BOMs and BOPs, in the order they are inserted — components before the
// assemblies that consume them.
// Fractional per-unit quantities are kept to halves, quarters and eighths.
// Extended quantity is float multiplication, so 0.05 x 3 renders as
// 0.15000000000000002 on the shop floor — these values multiply out clean.
export const METHODS: MakeMethodSpec[] = [
  {
    readableId: "LAM-STK-STA",
    bom: [{ component: "MAT-LAM-M19", quantity: 18, order: 1 }],
    bop: [
      {
        process: "Lamination Stacking",
        workCenter: "Lamination Press",
        description: "Blank, stack and bond stator laminations",
        order: 1,
        laborTime: 1.25
      },
      {
        process: "In-Process Inspection",
        workCenter: "CMM Inspection Bench",
        description: "Stack height and bore concentricity check",
        order: 2,
        laborTime: 0.5
      }
    ]
  },
  {
    readableId: "LAM-STK-ROT",
    bom: [{ component: "MAT-LAM-M19", quantity: 11, order: 1 }],
    bop: [
      {
        process: "Lamination Stacking",
        workCenter: "Lamination Press",
        description: "Blank, stack and bond rotor laminations",
        order: 1,
        laborTime: 1
      },
      {
        process: "In-Process Inspection",
        workCenter: "CMM Inspection Bench",
        description: "Stack height and magnet pocket check",
        order: 2,
        laborTime: 0.5
      }
    ]
  },
  {
    readableId: "SHF-9000",
    bom: [{ component: "MAT-STL-4140", quantity: 9, order: 1 }],
    bop: [
      {
        process: "CNC Machining",
        workCenter: "CNC Turning Cell",
        description: "Turn and grind shaft journals and keyway",
        order: 1,
        laborTime: 1.5
      },
      // Sent out to Maumee for nitride between turning and final inspection.
      {
        process: "Outside Processing",
        description: "Nitride shaft journals at supplier",
        order: 2,
        operationType: "Outside Processing",
        supplierProcess: "sp:Maumee Contract Machining:Outside Processing",
        operationLeadTime: 6,
        operationUnitCost: 48,
        laborTime: 0,
        laborUnit: "Total Hours"
      },
      {
        process: "In-Process Inspection",
        workCenter: "CMM Inspection Bench",
        description: "Journal diameter and runout check",
        order: 3,
        laborTime: 0.5
      }
    ]
  },
  {
    readableId: "COIL-9000",
    bom: [
      { component: "MAT-CU-18AWG", quantity: 6.5, order: 1 },
      { component: "MAT-INS-NOMEX", quantity: 0.5, order: 2 }
    ],
    bop: [
      {
        process: "Coil Winding",
        workCenter: "Winding Line 1",
        description: "Wind and form the coil set",
        order: 1,
        laborTime: 2.5
      },
      {
        process: "In-Process Inspection",
        workCenter: "CMM Inspection Bench",
        description: "Turn count and coil pitch verification",
        order: 2,
        laborTime: 0.5
      }
    ]
  },
  {
    readableId: "STA-9000",
    bom: [
      { component: "LAM-STK-STA", quantity: 1, order: 1 },
      { component: "COIL-9000", quantity: 1, order: 2 },
      { component: "MAT-INS-NOMEX", quantity: 0.25, order: 3 },
      { component: "MAT-VARNISH", quantity: 0.25, order: 4 }
    ],
    bop: [
      {
        process: "Coil Winding",
        workCenter: "Winding Line 1",
        description: "Insert coils, lace end turns and connect phases",
        order: 1,
        laborTime: 3,
        // Gives the MES operation screen an Instructions tab with real steps.
        procedure: "procedure:Stator Winding & Impregnation"
      },
      {
        process: "Varnish Impregnation",
        workCenter: "Impregnation Oven",
        description: "Trickle impregnate and bake Class H varnish",
        order: 2,
        laborTime: 6,
        laborUnit: "Total Hours"
      },
      {
        process: "In-Process Inspection",
        workCenter: "CMM Inspection Bench",
        description: "Bore, surge and varnish coverage check",
        order: 3,
        laborTime: 1,
        procedure: "procedure:In-Process Stator Inspection"
      }
    ]
  },
  {
    readableId: "ROT-9000",
    bom: [
      { component: "LAM-STK-ROT", quantity: 1, order: 1 },
      { component: "SHF-9000", quantity: 1, order: 2 },
      { component: "MAG-NDFB-45", quantity: 24, order: 3 },
      { component: "CN-EPOXY-MAG", quantity: 0.125, order: 4 }
    ],
    bop: [
      {
        process: "Motor Assembly",
        workCenter: "Motor Assembly Bench",
        description: "Press stack to shaft and bond magnet segments",
        order: 1,
        laborTime: 2.5
      },
      {
        process: "Rotor Balancing",
        workCenter: "Balancing Cell",
        description: "Two-plane dynamic balance",
        order: 2,
        laborTime: 1,
        procedure: "procedure:Rotor Balance Verification"
      },
      {
        process: "In-Process Inspection",
        workCenter: "CMM Inspection Bench",
        description: "Outer diameter and residual unbalance review",
        order: 3,
        laborTime: 0.5
      }
    ]
  },
  {
    readableId: "HSG-9000",
    bom: [
      { component: "MAT-AL6061-BAR", quantity: 26, order: 1 },
      { component: "SEAL-VR-45", quantity: 2, order: 2 },
      { component: "FST-M10-SS", quantity: 8, order: 3 }
    ],
    bop: [
      {
        process: "CNC Machining",
        workCenter: "CNC Turning Cell",
        description: "Bore housing and machine both end bells",
        order: 1,
        laborTime: 3
      },
      {
        process: "Outside Processing",
        description: "Hard anodize (Type III) at supplier",
        order: 2,
        operationType: "Outside Processing",
        supplierProcess: "sp:Maumee Contract Machining:Outside Processing",
        operationLeadTime: 7,
        operationUnitCost: 95,
        laborTime: 0,
        laborUnit: "Total Hours"
      },
      {
        process: "In-Process Inspection",
        workCenter: "CMM Inspection Bench",
        description: "Bearing fit and register concentricity check",
        order: 3,
        laborTime: 0.75
      }
    ]
  },
  {
    readableId: "TRM-BOX-9000",
    bom: [
      { component: "TRM-BLK-6P", quantity: 1, order: 1 },
      { component: "MAT-AL6061-BAR", quantity: 2.5, order: 2 },
      { component: "FST-M6-SS", quantity: 6, order: 3 }
    ],
    bop: [
      {
        process: "CNC Machining",
        workCenter: "CNC Turning Cell",
        description: "Machine terminal box body and gland holes",
        order: 1,
        laborTime: 0.75
      },
      {
        process: "Motor Assembly",
        workCenter: "Motor Assembly Bench",
        description: "Fit terminal block, gasket and label",
        order: 2,
        laborTime: 0.5
      }
    ]
  },
  {
    readableId: "STA-4500",
    bom: [
      { component: "MAT-LAM-M19", quantity: 11, order: 1 },
      { component: "MAT-CU-18AWG", quantity: 4, order: 2 },
      { component: "MAT-INS-NOMEX", quantity: 0.375, order: 3 },
      { component: "MAT-VARNISH", quantity: 0.125, order: 4 }
    ],
    bop: [
      {
        process: "Lamination Stacking",
        workCenter: "Lamination Press",
        description: "Stack and bond 4500-frame stator laminations",
        order: 1,
        laborTime: 1
      },
      {
        process: "Coil Winding",
        workCenter: "Winding Line 1",
        description: "Wind, insert and lace the 4500-frame stator",
        order: 2,
        laborTime: 2.5,
        procedure: "procedure:Stator Winding & Impregnation"
      },
      {
        process: "Varnish Impregnation",
        workCenter: "Impregnation Oven",
        description: "Trickle impregnate and bake Class H varnish",
        order: 3,
        laborTime: 5,
        laborUnit: "Total Hours"
      },
      {
        process: "In-Process Inspection",
        workCenter: "CMM Inspection Bench",
        description: "Bore and surge comparison check",
        order: 4,
        laborTime: 0.75,
        procedure: "procedure:In-Process Stator Inspection"
      }
    ]
  },
  {
    readableId: "MTR-9000",
    bom: [
      { component: "STA-9000", quantity: 1, order: 1 },
      { component: "ROT-9000", quantity: 1, order: 2 },
      { component: "HSG-9000", quantity: 1, order: 3 },
      { component: "TRM-BOX-9000", quantity: 1, order: 4 },
      { component: "BRG-6308-C3", quantity: 2, order: 5 },
      { component: "ENC-INC-2048", quantity: 1, order: 6 },
      { component: "FAN-AX-160", quantity: 1, order: 7 },
      { component: "NPL-SS-STD", quantity: 1, order: 8 },
      { component: "CN-BRG-GREASE", quantity: 0.25, order: 9 }
    ],
    bop: [
      // Assembly (not Process) so the MES routes this operation to the assembly
      // view, where tracked components are scanned into the serial being built.
      {
        process: "Motor Assembly",
        workCenter: "Motor Assembly Bench",
        description: "Rotor insertion, bearing fit and final build",
        order: 1,
        laborTime: 4,
        operationType: "Assembly",
        // Gives the MES assembly view its step checklist.
        procedure: "procedure:Motor Final Assembly"
      },
      {
        process: "Final Test & Inspection",
        workCenter: "Dyno Test Cell",
        description: "No-load, loaded and thermal dyno run",
        order: 2,
        laborTime: 3,
        procedure: "procedure:Dynamometer Acceptance Test"
      },
      {
        process: "Final Test & Inspection",
        workCenter: "CMM Inspection Bench",
        description: "Acceptance data package review and nameplate stamp",
        order: 3,
        laborTime: 1
      }
    ]
  },
  {
    readableId: "MTR-4500",
    bom: [
      { component: "STA-4500", quantity: 1, order: 1 },
      { component: "MAG-NDFB-38", quantity: 18, order: 2 },
      { component: "MAT-STL-4140", quantity: 5, order: 3 },
      { component: "BRG-6206-C3", quantity: 2, order: 4 },
      { component: "SEAL-VR-45", quantity: 2, order: 5 },
      { component: "TRM-BLK-6P", quantity: 1, order: 6 },
      { component: "NPL-SS-STD", quantity: 1, order: 7 },
      { component: "FST-M6-SS", quantity: 8, order: 8 },
      { component: "CN-BRG-GREASE", quantity: 0.125, order: 9 }
    ],
    bop: [
      {
        process: "Motor Assembly",
        workCenter: "Motor Assembly Bench",
        description: "Build 4500-frame rotor and complete the motor",
        order: 1,
        laborTime: 3,
        operationType: "Assembly",
        procedure: "procedure:Motor Final Assembly"
      },
      {
        process: "Final Test & Inspection",
        workCenter: "Dyno Test Cell",
        description: "Dyno acceptance run",
        order: 2,
        laborTime: 2,
        procedure: "procedure:Dynamometer Acceptance Test"
      }
    ]
  }
];

// Which supplier can supply what
export const SUPPLIER_LINKS: SupplierLinkSpec[] = [
  {
    supplier: "Meridian Magnetics",
    item: "MAG-NDFB-45",
    price: 18.5,
    leadTime: 60
  },
  {
    supplier: "Meridian Magnetics",
    item: "MAG-NDFB-38",
    price: 14.2,
    leadTime: 60
  },
  {
    supplier: "Copperline Wire Works",
    item: "MAT-CU-18AWG",
    price: 6.4,
    leadTime: 21
  },
  {
    supplier: "Copperline Wire Works",
    item: "MAT-INS-NOMEX",
    price: 12.5,
    leadTime: 21
  },
  {
    supplier: "Copperline Wire Works",
    item: "MAT-VARNISH",
    price: 84,
    leadTime: 14
  },
  {
    supplier: "Copperline Wire Works",
    item: "TRM-BLK-6P",
    price: 8.9,
    leadTime: 14
  },
  {
    supplier: "Copperline Wire Works",
    item: "ENC-INC-2048",
    price: 96,
    leadTime: 35
  },
  {
    supplier: "Lakeland Electrical Steel",
    item: "MAT-LAM-M19",
    price: 1.85,
    leadTime: 28
  },
  {
    supplier: "Lakeland Electrical Steel",
    item: "MAT-STL-4140",
    price: 2.7,
    leadTime: 14
  },
  {
    supplier: "Lakeland Electrical Steel",
    item: "MAT-AL6061-BAR",
    price: 3.9,
    leadTime: 10
  },
  {
    supplier: "Summit Bearing Supply",
    item: "BRG-6206-C3",
    price: 12.4,
    leadTime: 21
  },
  {
    supplier: "Summit Bearing Supply",
    item: "BRG-6308-C3",
    price: 26.8,
    leadTime: 21
  },
  {
    supplier: "Summit Bearing Supply",
    item: "SEAL-VR-45",
    price: 3.6,
    leadTime: 14
  },
  {
    supplier: "Ironwood Fasteners",
    item: "FST-M6-SS",
    price: 0.42,
    leadTime: 10
  },
  {
    supplier: "Ironwood Fasteners",
    item: "FST-M10-SS",
    price: 1.15,
    leadTime: 10
  }
];

export const motorItems: ItemsData = {
  buyParts: BUY_PARTS,
  materials: MATERIALS,
  consumables: CONSUMABLES,
  tools: TOOLS,
  services: SERVICES,
  makeParts: MAKE_PARTS,
  methods: METHODS,
  supplierLinks: SUPPLIER_LINKS
};
