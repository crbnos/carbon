import type { ItemSpec } from "../../helpers/items.ts";
import type {
  ItemsData,
  MakeMethodSpec,
  SupplierLinkSpec
} from "../../types.ts";

// ---------------------------------------------------------------------------
// Job-shop catalog for Meridian Precision Works.
// Namespace items by type so readableIds can't collide across extension tables.
//   HMA- / MCH- / FAB- / ASM- = Make Parts (Part type)
//   HW- / INS- / BRG- / BSH- / SEAL- / SPR- / PIN- / CYL- = Buy Parts
//   MAT- = Materials
//   TL-  = Tools
//   SVC- = Services
//   CN-  = Consumables
// ---------------------------------------------------------------------------

export const BUY_PARTS: ItemSpec[] = [
  // Fasteners and inserts
  {
    readableId: "HW-SHCS-M6",
    name: "M6 x 20 Socket Head Cap Screw (18-8)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 0.42,
    unitSalePrice: 0.75,
    leadTime: 10
  },
  {
    readableId: "HW-SHCS-M10",
    name: "M10 x 35 Socket Head Cap Screw (18-8)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 1.1,
    unitSalePrice: 1.85,
    leadTime: 10
  },
  {
    readableId: "HW-DOWEL-8",
    name: "8mm x 24 Hardened Dowel Pin",
    type: "Part",
    replenishment: "Buy",
    standardCost: 0.95,
    unitSalePrice: 1.6,
    leadTime: 14
  },
  {
    readableId: "INS-HELI-M6",
    name: "M6 Screw-Lock Threaded Insert",
    type: "Part",
    replenishment: "Buy",
    standardCost: 0.68,
    unitSalePrice: 1.15,
    leadTime: 14
  },
  // Bearings, bushings and seals
  {
    readableId: "BRG-DBL-6205",
    name: "Deep Groove Ball Bearing 6205-2RS",
    type: "Part",
    replenishment: "Buy",
    // Batch-tracked: receiving captures the lot, and the lot is what a bearing
    // vendor's containment notice is scoped to.
    trackingType: "Batch",
    standardCost: 12.4,
    unitSalePrice: 19,
    leadTime: 21
  },
  {
    readableId: "BRG-NDL-HK1512",
    name: "Drawn Cup Needle Bearing HK1512",
    type: "Part",
    replenishment: "Buy",
    standardCost: 6.8,
    unitSalePrice: 10.5,
    leadTime: 21
  },
  {
    readableId: "BSH-BRZ-2012",
    name: "Oil-Impregnated Bronze Bushing 20 x 12",
    type: "Part",
    replenishment: "Buy",
    standardCost: 3.9,
    unitSalePrice: 6.5,
    leadTime: 14
  },
  {
    readableId: "SEAL-ORING-224",
    name: "O-Ring Buna-N AS568-224",
    type: "Part",
    replenishment: "Buy",
    standardCost: 0.35,
    unitSalePrice: 0.6,
    leadTime: 10
  },
  {
    readableId: "SPR-DIE-25",
    name: "Die Spring 25mm Medium Load",
    type: "Part",
    replenishment: "Buy",
    standardCost: 4.2,
    unitSalePrice: 7,
    leadTime: 21
  },
  {
    readableId: "PIN-CLEVIS-12",
    name: "12mm Clevis Pin, Zinc Plated",
    type: "Part",
    replenishment: "Buy",
    standardCost: 2.4,
    unitSalePrice: 4,
    leadTime: 14
  },
  {
    readableId: "CYL-HYD-40",
    name: "Hydraulic Cylinder 40mm Bore x 200 Stroke",
    type: "Part",
    replenishment: "Buy",
    // Serial-tracked: the cylinder serial is what a field warranty claim on a
    // finished manifold assembly is argued over.
    trackingType: "Serial",
    standardCost: 285,
    unitSalePrice: 430,
    leadTime: 35
  }
];

export const MATERIALS: ItemSpec[] = [
  {
    readableId: "MAT-AL6061-BAR",
    name: "Aluminum 6061-T6 Round Bar 2.000 in",
    type: "Material",
    trackingType: "Batch",
    standardCost: 3.85,
    unitOfMeasureCode: "LB",
    leadTime: 10
  },
  {
    readableId: "MAT-AL5052-SHT",
    name: "Aluminum 5052-H32 Sheet 0.090 in",
    type: "Material",
    standardCost: 2.95,
    unitOfMeasureCode: "LB",
    leadTime: 12
  },
  {
    readableId: "MAT-SS304-BAR",
    name: "Stainless 304 Round Bar 1.500 in",
    type: "Material",
    trackingType: "Batch",
    standardCost: 4.6,
    unitOfMeasureCode: "LB",
    leadTime: 14
  },
  {
    readableId: "MAT-SS316-PLT",
    name: "Stainless 316L Plate 0.250 in",
    type: "Material",
    standardCost: 6.2,
    unitOfMeasureCode: "LB",
    leadTime: 18
  },
  {
    readableId: "MAT-4140-BAR",
    name: "Alloy Steel 4140 Pre-Hard Round Bar 2.500 in",
    type: "Material",
    trackingType: "Batch",
    standardCost: 2.75,
    unitOfMeasureCode: "LB",
    leadTime: 14
  },
  {
    readableId: "MAT-CRS-TUBE",
    name: "Cold-Rolled Steel Tube 2 x 2 x 0.120",
    type: "Material",
    standardCost: 2.1,
    unitOfMeasureCode: "FOOT",
    leadTime: 12
  }
];

export const CONSUMABLES: ItemSpec[] = [
  {
    readableId: "CN-COOLANT-55",
    name: "Semi-Synthetic Cutting Fluid, 55 gal",
    type: "Consumable",
    standardCost: 1450,
    leadTime: 14
  },
  {
    readableId: "CN-DEBURR-MED",
    name: "Ceramic Deburring Media",
    type: "Consumable",
    standardCost: 38,
    unitOfMeasureCode: "LB"
  }
];

export const TOOLS: ItemSpec[] = [
  {
    readableId: "TL-VISE-6IN",
    name: "6 in Precision Machine Vise",
    type: "Tool",
    standardCost: 890
  },
  {
    readableId: "TL-FIXT-HSG",
    name: "Pump Housing Op-2 Soft-Jaw Fixture",
    type: "Tool",
    standardCost: 2400
  }
];

export const SERVICES: ItemSpec[] = [
  {
    readableId: "SVC-CMM-PROG",
    name: "CMM Program Development (external)",
    type: "Service",
    replenishment: "Buy",
    standardCost: 1250,
    leadTime: 14
  }
];

// Make parts — the shop's own part numbers for work built to customer prints.
export const MAKE_PARTS: ItemSpec[] = [
  {
    readableId: "HMA-4000",
    name: "Hydraulic Power Unit Manifold Assembly",
    type: "Part",
    replenishment: "Make",
    // Serial-tracked: each unit gets its own genealogy in traceability.
    trackingType: "Serial",
    standardCost: 0,
    unitSalePrice: 4200
  },
  {
    readableId: "MCH-MANI-BLK",
    name: "Manifold Block, 6061-T6",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 980
  },
  {
    readableId: "MCH-HSG-PUMP",
    name: "Pump Housing, 6061-T6",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 1150
  },
  {
    readableId: "MCH-END-CAP",
    name: "Manifold End Cap, 316L",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 240
  },
  {
    readableId: "MCH-SHAFT-DR",
    name: "Drive Shaft, 4140 Pre-Hard",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 320
  },
  {
    readableId: "MCH-PISTON-ROD",
    name: "Piston Rod, 4140 Hard Chrome",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 420
  },
  {
    readableId: "MCH-FLANGE-SS",
    name: "Mounting Flange, 304 Stainless",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 185
  },
  {
    readableId: "MCH-SPACER-KIT",
    name: "Precision Spacer Set",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 105
  },
  {
    readableId: "FAB-ENCL-PNL",
    name: "Sheet Metal Enclosure Panel Set",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 640
  },
  {
    readableId: "FAB-BASE-WLD",
    name: "Welded Base Frame",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 1480
  },
  {
    readableId: "ASM-VALVE-SUB",
    name: "Valve Sub-Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 890
  }
];

// BOMs and BOPs, in the order they are inserted — components before the
// assemblies that consume them.
// Fractional per-unit quantities are kept to halves, quarters and eighths.
// Extended quantity is float multiplication, so 0.05 x 3 renders as
// 0.15000000000000002 on the shop floor — these values multiply out clean.
export const METHODS: MakeMethodSpec[] = [
  {
    readableId: "MCH-MANI-BLK",
    bom: [
      { component: "MAT-AL6061-BAR", quantity: 18, order: 1 },
      { component: "INS-HELI-M6", quantity: 12, order: 2 },
      { component: "SEAL-ORING-224", quantity: 8, order: 3 }
    ],
    bop: [
      {
        process: "CNC Milling",
        workCenter: "VMC Cell 1",
        description: "Rough and finish mill the block, drill the port pattern",
        order: 1,
        laborTime: 2.5,
        setupTime: 1,
        machineTime: 2
      },
      {
        process: "Wire EDM",
        workCenter: "Wire EDM Cell",
        description: "Cut the cross-drilled relief slots",
        order: 2,
        laborTime: 0.75
      },
      // The block leaves the building between machining and finishing — this is
      // the routing step the OSP warehouse exists for.
      {
        process: "Outside Processing",
        description: "Hard anodize (Type III) at supplier",
        order: 3,
        operationType: "Outside Processing",
        supplierProcess: "sp:Anvil Finishing Group:Outside Processing",
        operationLeadTime: 5,
        operationUnitCost: 42,
        laborTime: 0,
        laborUnit: "Total Hours"
      },
      {
        process: "Deburr & Finish",
        workCenter: "Finish & Assembly Bench",
        description: "Deburr ports, install inserts, clean and bag",
        order: 4,
        laborTime: 0.5
      }
    ]
  },
  {
    readableId: "MCH-HSG-PUMP",
    bom: [
      { component: "MAT-AL6061-BAR", quantity: 26, order: 1 },
      { component: "BRG-DBL-6205", quantity: 2, order: 2 },
      { component: "BRG-NDL-HK1512", quantity: 2, order: 3 },
      { component: "INS-HELI-M6", quantity: 8, order: 4 },
      { component: "CN-COOLANT-55", quantity: 0.125, order: 5 }
    ],
    bop: [
      {
        process: "CNC Milling",
        workCenter: "VMC Cell 2",
        description: "Op 1 — square the billet and rough the cavity",
        order: 1,
        laborTime: 1.5,
        setupTime: 0.75,
        machineTime: 1.25
      },
      {
        process: "CNC Milling",
        workCenter: "VMC Cell 2",
        description: "Op 2 — finish the bearing bore and mounting face",
        order: 2,
        laborTime: 2,
        machineTime: 1.75,
        // Gives the MES operation screen an Instructions tab with real steps.
        procedure: "procedure:Pump Housing Second Operation"
      },
      {
        process: "Outside Processing",
        description: "Clear anodize (Type II) at supplier",
        order: 3,
        operationType: "Outside Processing",
        supplierProcess: "sp:Anvil Finishing Group:Outside Processing",
        operationLeadTime: 5,
        operationUnitCost: 28,
        laborTime: 0,
        laborUnit: "Total Hours"
      },
      {
        process: "Final Inspection",
        workCenter: "CMM Lab",
        description: "CMM bore report and press-fit check",
        order: 4,
        laborTime: 0.75
      }
    ]
  },
  {
    readableId: "MCH-END-CAP",
    bom: [
      { component: "MAT-SS316-PLT", quantity: 3, order: 1 },
      { component: "SEAL-ORING-224", quantity: 2, order: 2 }
    ],
    bop: [
      {
        process: "CNC Turning",
        workCenter: "Turning Cell",
        description: "Turn the cap profile and O-ring groove",
        order: 1,
        laborTime: 0.5,
        setupTime: 0.5,
        machineTime: 0.4
      },
      {
        process: "Deburr & Finish",
        workCenter: "Finish & Assembly Bench",
        description: "Passivate, deburr and fit the O-ring",
        order: 2,
        laborTime: 0.25
      }
    ]
  },
  {
    readableId: "MCH-SHAFT-DR",
    bom: [
      { component: "MAT-4140-BAR", quantity: 6, order: 1 },
      { component: "HW-DOWEL-8", quantity: 2, order: 2 }
    ],
    bop: [
      {
        process: "CNC Turning",
        workCenter: "Turning Cell",
        description: "Turn the shaft diameters and cut the keyway seat",
        order: 1,
        laborTime: 1.25,
        setupTime: 0.5,
        machineTime: 1
      },
      {
        process: "Outside Processing",
        description: "Induction harden and temper at supplier",
        order: 2,
        operationType: "Outside Processing",
        supplierProcess: "sp:Forge Heat Treating:Outside Processing",
        operationLeadTime: 7,
        operationUnitCost: 36,
        laborTime: 0,
        laborUnit: "Total Hours"
      },
      {
        process: "Final Inspection",
        workCenter: "CMM Lab",
        description: "Hardness check and runout report",
        order: 3,
        laborTime: 0.5
      }
    ]
  },
  {
    readableId: "MCH-PISTON-ROD",
    bom: [
      { component: "MAT-4140-BAR", quantity: 8, order: 1 },
      { component: "BSH-BRZ-2012", quantity: 2, order: 2 }
    ],
    bop: [
      {
        process: "CNC Turning",
        workCenter: "Turning Cell",
        description: "Turn and thread the rod, roll-burnish the bearing area",
        order: 1,
        laborTime: 1.5,
        machineTime: 1.25
      },
      {
        process: "Outside Processing",
        description: "Hard chrome plate and grind at supplier",
        order: 2,
        operationType: "Outside Processing",
        supplierProcess: "sp:Anvil Finishing Group:Outside Processing",
        operationLeadTime: 10,
        operationUnitCost: 64,
        laborTime: 0,
        laborUnit: "Total Hours"
      },
      {
        process: "Final Inspection",
        workCenter: "CMM Lab",
        description: "Plating thickness and straightness check",
        order: 3,
        laborTime: 0.5
      }
    ]
  },
  {
    readableId: "MCH-FLANGE-SS",
    bom: [
      { component: "MAT-SS304-BAR", quantity: 4, order: 1 },
      { component: "HW-SHCS-M10", quantity: 6, order: 2 }
    ],
    bop: [
      {
        process: "CNC Turning",
        workCenter: "Turning Cell",
        description: "Turn the flange face and register diameter",
        order: 1,
        laborTime: 0.6,
        machineTime: 0.5
      },
      {
        process: "CNC Milling",
        workCenter: "VMC Cell 1",
        description: "Mill the bolt pattern and clearance reliefs",
        order: 2,
        laborTime: 0.4
      },
      {
        process: "Deburr & Finish",
        workCenter: "Finish & Assembly Bench",
        description: "Passivate and deburr",
        order: 3,
        laborTime: 0.2
      }
    ]
  },
  {
    readableId: "MCH-SPACER-KIT",
    bom: [
      { component: "MAT-SS304-BAR", quantity: 1.5, order: 1 },
      { component: "HW-SHCS-M6", quantity: 8, order: 2 }
    ],
    bop: [
      {
        process: "CNC Turning",
        workCenter: "Turning Cell",
        description: "Turn and part off the spacer set",
        order: 1,
        laborTime: 0.4,
        machineTime: 0.35
      },
      {
        process: "Deburr & Finish",
        workCenter: "Finish & Assembly Bench",
        description: "Deburr, sort by length and kit",
        order: 2,
        laborTime: 0.25
      }
    ]
  },
  {
    readableId: "FAB-ENCL-PNL",
    bom: [
      { component: "MAT-AL5052-SHT", quantity: 22, order: 1 },
      { component: "HW-SHCS-M6", quantity: 16, order: 2 }
    ],
    bop: [
      {
        process: "Sheet Metal Fabrication",
        workCenter: "Fab & Weld Bay",
        description: "Punch, form and hardware-insert the panel set",
        order: 1,
        laborTime: 1.75,
        setupTime: 0.5
      },
      {
        process: "Deburr & Finish",
        workCenter: "Finish & Assembly Bench",
        description: "Deburr edges and mask for paint",
        order: 2,
        laborTime: 0.5
      }
    ]
  },
  {
    readableId: "FAB-BASE-WLD",
    bom: [
      { component: "MAT-CRS-TUBE", quantity: 24, order: 1 },
      { component: "MAT-SS316-PLT", quantity: 8, order: 2 },
      { component: "HW-SHCS-M10", quantity: 12, order: 3 }
    ],
    bop: [
      {
        process: "Sheet Metal Fabrication",
        workCenter: "Fab & Weld Bay",
        description: "Cut and notch the tube frame members",
        order: 1,
        laborTime: 1.5
      },
      {
        process: "Welding",
        workCenter: "Fab & Weld Bay",
        description: "Fixture, tack and MIG weld the frame",
        order: 2,
        laborTime: 3
      },
      {
        process: "Final Inspection",
        workCenter: "CMM Lab",
        description: "Weld visual and flatness check",
        order: 3,
        laborTime: 0.75
      }
    ]
  },
  {
    readableId: "ASM-VALVE-SUB",
    bom: [
      { component: "MCH-END-CAP", quantity: 2, order: 1 },
      { component: "SPR-DIE-25", quantity: 4, order: 2 },
      { component: "SEAL-ORING-224", quantity: 6, order: 3 },
      { component: "PIN-CLEVIS-12", quantity: 2, order: 4 }
    ],
    bop: [
      {
        process: "Mechanical Assembly",
        workCenter: "Finish & Assembly Bench",
        description: "Assemble the valve cartridge stack",
        order: 1,
        laborTime: 1.25
      },
      {
        process: "Final Inspection",
        workCenter: "CMM Lab",
        description: "Cracking pressure and leak check",
        order: 2,
        laborTime: 0.75
      }
    ]
  },
  {
    readableId: "HMA-4000",
    bom: [
      { component: "MCH-MANI-BLK", quantity: 1, order: 1 },
      { component: "MCH-HSG-PUMP", quantity: 1, order: 2 },
      { component: "MCH-SHAFT-DR", quantity: 1, order: 3 },
      { component: "MCH-PISTON-ROD", quantity: 1, order: 4 },
      { component: "ASM-VALVE-SUB", quantity: 1, order: 5 },
      { component: "FAB-BASE-WLD", quantity: 1, order: 6 },
      { component: "FAB-ENCL-PNL", quantity: 1, order: 7 },
      { component: "MCH-FLANGE-SS", quantity: 2, order: 8 },
      { component: "MCH-SPACER-KIT", quantity: 1, order: 9 },
      { component: "CYL-HYD-40", quantity: 1, order: 10 },
      { component: "CN-DEBURR-MED", quantity: 0.5, order: 11 }
    ],
    bop: [
      // Assembly (not Process) so the MES routes this operation to the assembly
      // view, where tracked components are scanned into the serial being built.
      {
        process: "Mechanical Assembly",
        workCenter: "Finish & Assembly Bench",
        description: "Build the manifold assembly onto the base frame",
        order: 1,
        laborTime: 6,
        operationType: "Assembly",
        // Gives the MES assembly view its step checklist.
        procedure: "procedure:Manifold Assembly Build"
      },
      {
        process: "Final Inspection",
        workCenter: "CMM Lab",
        description: "Hydrostatic proof test at 1.5x rated pressure",
        order: 2,
        laborTime: 4,
        laborUnit: "Total Hours"
      },
      {
        process: "Final Inspection",
        workCenter: "CMM Lab",
        description: "Final dimensional report and certificate of conformance",
        order: 3,
        laborTime: 1.5,
        procedure: "procedure:Final Dimensional Inspection"
      }
    ]
  }
];

// Which supplier can supply what
export const SUPPLIER_LINKS: SupplierLinkSpec[] = [
  {
    supplier: "Rock River Metals",
    item: "MAT-AL6061-BAR",
    price: 3.85,
    leadTime: 10
  },
  {
    supplier: "Rock River Metals",
    item: "MAT-AL5052-SHT",
    price: 2.95,
    leadTime: 12
  },
  {
    supplier: "Rock River Metals",
    item: "MAT-CRS-TUBE",
    price: 2.1,
    leadTime: 12
  },
  {
    supplier: "Bluestem Alloys",
    item: "MAT-SS304-BAR",
    price: 4.6,
    leadTime: 14
  },
  {
    supplier: "Bluestem Alloys",
    item: "MAT-SS316-PLT",
    price: 6.2,
    leadTime: 18
  },
  {
    supplier: "Bluestem Alloys",
    item: "MAT-4140-BAR",
    price: 2.75,
    leadTime: 14
  },
  {
    supplier: "Fastline Industrial Supply",
    item: "HW-SHCS-M6",
    price: 0.42,
    leadTime: 10
  },
  {
    supplier: "Fastline Industrial Supply",
    item: "HW-SHCS-M10",
    price: 1.1,
    leadTime: 10
  },
  {
    supplier: "Fastline Industrial Supply",
    item: "HW-DOWEL-8",
    price: 0.95,
    leadTime: 14
  },
  {
    supplier: "Fastline Industrial Supply",
    item: "INS-HELI-M6",
    price: 0.68,
    leadTime: 14
  },
  {
    supplier: "Midway Bearing & Seal",
    item: "BRG-DBL-6205",
    price: 12.4,
    leadTime: 21
  },
  {
    supplier: "Midway Bearing & Seal",
    item: "BRG-NDL-HK1512",
    price: 6.8,
    leadTime: 21
  },
  {
    supplier: "Midway Bearing & Seal",
    item: "SEAL-ORING-224",
    price: 0.35,
    leadTime: 10
  }
];

export const precisionItems: ItemsData = {
  buyParts: BUY_PARTS,
  materials: MATERIALS,
  consumables: CONSUMABLES,
  tools: TOOLS,
  services: SERVICES,
  makeParts: MAKE_PARTS,
  methods: METHODS,
  supplierLinks: SUPPLIER_LINKS
};
