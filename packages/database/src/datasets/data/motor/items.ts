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
import { motorAssembly } from "./assembly.ts";

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
  },
  // Successor of BRG-6206-C3 (see SUPERSESSIONS). Deliberately absent from
  // every BOM: job creation and picking redirect to it live.
  {
    readableId: "BRG-6206-HYB",
    name: "Hybrid Ceramic Bearing 6206 (Si3N4 balls)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 34,
    unitSalePrice: 52,
    leadTime: 28
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
    leadTime: 28,
    // Fully classified against the company taxonomy (foundation.ts).
    material: {
      substance: "Electrical Steel",
      form: "Lamination Coil",
      materialType: "Electrical Steel Lamination Coil",
      grade: "M19",
      finish: "C5 Insulation Coating",
      dimension: "0.35mm x 200mm"
    }
  },
  {
    readableId: "MAT-CU-18AWG",
    name: "Enameled Copper Magnet Wire 18 AWG",
    type: "Material",
    // Batch-tracked: a winding failure is traced back to the wire spool lot.
    trackingType: "Batch",
    standardCost: 6.4,
    unitOfMeasureCode: "LB",
    leadTime: 21,
    // Partial classification: magnet wire is graded and coated, not dimensioned
    // like a coil — the spool length varies by put-up.
    material: {
      substance: "Enameled Copper",
      grade: "MW 35-C",
      finish: "Polyamide-Imide Overcoat"
    }
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
    standardCost: 2670,
    unitSalePrice: 4850
  },
  {
    readableId: "MTR-4500",
    name: "TD-4500 Servo Motor Assembly (Complete)",
    type: "Part",
    replenishment: "Make",
    trackingType: "Serial",
    standardCost: 1620,
    unitSalePrice: 2950
  },
  {
    readableId: "STA-9000",
    name: "Stator Assembly (9000 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 649,
    unitSalePrice: 1180
  },
  {
    readableId: "STA-4500",
    name: "Stator Assembly (4500 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 429,
    unitSalePrice: 780
  },
  {
    readableId: "ROT-9000",
    name: "Rotor Assembly (9000 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 781,
    unitSalePrice: 1420
  },
  {
    readableId: "HSG-9000",
    name: "Motor Housing & End Bells (9000 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 352,
    unitSalePrice: 640
  },
  {
    readableId: "SHF-9000",
    name: "Precision Motor Shaft (9000 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 116,
    unitSalePrice: 210
  },
  {
    readableId: "COIL-9000",
    name: "Wound Coil Set (9000 Frame)",
    type: "Part",
    replenishment: "Make",
    standardCost: 264,
    unitSalePrice: 480
  },
  {
    readableId: "LAM-STK-STA",
    name: "Stator Lamination Stack",
    type: "Part",
    replenishment: "Make",
    standardCost: 143,
    unitSalePrice: 260
  },
  {
    readableId: "LAM-STK-ROT",
    name: "Rotor Lamination Stack",
    type: "Part",
    replenishment: "Make",
    standardCost: 105,
    unitSalePrice: 190
  },
  {
    readableId: "TRM-BOX-9000",
    name: "Terminal Box Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 90.75,
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
        setupTime: 0.75,
        machineTime: 0.5,
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
        setupTime: 0.5,
        machineTime: 1.25,
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
        laborTime: 0.5,
        operationType: "Inspection",
        inspectionPlan: "SHF-9000-JOURNAL"
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
        setupTime: 0.5,
        machineTime: 2,
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
        setupTime: 0.5,
        laborTime: 2.5,
        tools: [{ tool: "TL-ARBOR-PRESS", quantity: 1 }],
        parameters: [
          { key: "Press-Fit Force", value: "35 kN max" },
          { key: "Epoxy Cure", value: "80 degC for 2 hours" }
        ]
      },
      {
        process: "Rotor Balancing",
        workCenter: "Balancing Cell",
        description: "Two-plane dynamic balance",
        order: 2,
        laborTime: 1,
        procedure: "procedure:Rotor Balance Verification",
        parameters: [
          { key: "Balance Grade", value: "ISO 21940 G2.5 at 3000 rpm" },
          {
            key: "Correction Method",
            value: "Material removal, drive-end plane first"
          }
        ]
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
  },
  {
    supplier: "Summit Bearing Supply",
    item: "BRG-6206-HYB",
    price: 34,
    leadTime: 28
  }
];

// MTR-4500 still names BRG-6206-C3 (60 on shelf A2-L1), so Consume First
// keeps pulling the steel bearing until the shelf is empty, then swaps to
// the hybrid ceramic.
export const SUPERSESSIONS: SupersessionSpec[] = [
  {
    predecessor: "BRG-6206-C3",
    successor: "BRG-6206-HYB",
    mode: "Consume First",
    successorEffectivityOffset: -14
  }
];

export const CUSTOMER_PARTS: CustomerPartSpec[] = [
  {
    item: "MTR-9000",
    customer: "Ridgeline Drive Systems",
    customerPartId: "RDS-MTR-9000",
    customerRevision: "B"
  },
  {
    item: "MTR-4500",
    customer: "Cardinal Motorworks",
    customerPartId: "CMW-SRV-4500"
  }
];

export const PRICE_OVERRIDES: PriceOverrideSpec[] = [
  {
    item: "MTR-4500",
    customer: "Cardinal Motorworks",
    notes: "Blanket-order pricing for the CY conveyor retrofit program.",
    breaks: [
      { quantity: 10, overridePrice: 2900 },
      { quantity: 50, overridePrice: 2760 }
    ]
  }
];

export const PRICING_RULES: PricingRuleSpec[] = [
  {
    name: "Ridgeline OEM volume discount",
    ruleType: "Discount",
    amountType: "Percentage",
    amount: 5,
    customer: "Ridgeline Drive Systems",
    minQuantity: 10,
    priority: 10
  },
  {
    name: "Aerospace documentation markup",
    ruleType: "Markup",
    amountType: "Percentage",
    amount: 8,
    customerType: "Aerospace",
    items: ["MTR-4500", "MTR-9000"],
    priority: 5
  },
  {
    name: "Distributor spares case break",
    ruleType: "Discount",
    amountType: "Percentage",
    amount: 6,
    customerType: "Distribution",
    items: ["BRG-6206-C3", "BRG-6308-C3", "FAN-AX-160"],
    minQuantity: 20,
    priority: 1
  }
];

export const CONFIGURATION: ConfigurationSpec = {
  item: "MTR-9000",
  group: "Drive Configuration",
  parameters: [
    {
      key: "shaft_extension_mm",
      label: "Shaft Extension Length (mm)",
      dataType: "numeric"
    },
    {
      key: "mounting_flange",
      label: "Mounting Flange",
      dataType: "list",
      listOptions: ["IEC B5", "IEC B14", "NEMA C-Face"]
    },
    {
      key: "holding_brake",
      label: "Include Holding Brake",
      dataType: "boolean"
    }
  ],
  rules: [
    {
      target: { operation: 1 },
      field: "laborTime",
      code: "return params.holding_brake ? 5 : 4;"
    },
    {
      target: { operation: 2 },
      field: "laborTime",
      code: "return params.shaft_extension_mm > 80 ? 3.5 : 3;"
    }
  ]
};

// HSG-9000 rev 0 is the released (Production) revision; rev A was obsoleted
// after casting porosity at the bearing bore, rev B adds the second gland boss
// and is in prototype.
export const REVISION_LADDER: RevisionLadderSpec[] = [
  {
    item: "HSG-9000",
    obsoleteRevision: "A",
    nextRevision: "B",
    nextStatus: "Prototype"
  }
];

// The shaft's post-nitride check is sampled against a plan of its own, so the
// MES opens an inspection lot for it rather than a plain operation.
export const INSPECTION_PLANS: InspectionPlanSpec[] = [
  {
    key: "SHF-9000-JOURNAL",
    item: "SHF-9000",
    drawingNumber: "TD-9000-SH Rev E",
    aql: 1.0,
    features: [
      {
        label: "1",
        description: "Drive-end bearing journal diameter",
        nominalValue: "40.010",
        tolerancePlus: "0.008",
        toleranceMinus: "0.008",
        unit: "mm"
      },
      {
        label: "2",
        description: "Journal runout, drive end to non-drive end",
        nominalValue: "0.008",
        tolerancePlus: "0.007",
        toleranceMinus: "0.008",
        unit: "mm"
      }
    ]
  }
];

// The traction motor is export-licensed for North America; distributors buy
// the 4500 by the pallet; magnets live in the cabinet; encoders stay at the
// plant; the impregnation oven has to be in service to start a cure.
export const ENFORCEMENT_RULES: EnforcementRuleSpec[] = [
  {
    family: "sales",
    name: "Traction motor — US and Canada ship-to only",
    description: "EAR99 review pending for the 9000-series drive.",
    message:
      "The MTR-9000 is cleared for US and Canadian customers only. Route export requests through Trade Compliance.",
    severity: "error",
    surfaces: ["salesOrderLine", "salesInvoiceLine"],
    match: "all",
    conditions: [
      {
        field: "customer.location.countryCode",
        op: "in",
        value: ["US", "CA"]
      }
    ],
    items: ["MTR-9000"]
  },
  {
    family: "sales",
    name: "Distributors order the 4500 by the pallet",
    message:
      "Distribution partners order the MTR-4500 in pallet quantities (4 or more).",
    severity: "warn",
    surfaces: ["quoteLine", "salesOrderLine"],
    match: "any",
    conditions: [
      {
        field: "customer.customerTypeId",
        op: "notIn",
        value: { customerTypes: ["Distribution"] }
      },
      { field: "transaction.quantity", op: "gt", value: 3 }
    ],
    items: ["MTR-4500"]
  },
  {
    family: "storage",
    targetType: "item",
    name: "Magnets in the cabinet",
    message:
      "Sintered NdFeB magnets are stored in the shielded cabinet, never on open shelving.",
    severity: "warn",
    surfaces: ["place"],
    match: "all",
    conditions: [
      {
        field: "storageUnit.storageTypeId",
        op: "eq",
        value: { storageType: "Cabinet" }
      }
    ],
    items: ["MAG-NDFB-45", "MAG-NDFB-38"]
  },
  {
    family: "storage",
    targetType: "item",
    name: "Encoders stay at the plant",
    message:
      "Encoders are kitted at the Fort Wayne plant only — pick a plant bin.",
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
    items: ["ENC-INC-2048"]
  },
  {
    family: "storage",
    targetType: "workCenter",
    name: "Impregnation oven in service",
    message:
      "The impregnation oven is out of service — hold the cure until maintenance releases it.",
    severity: "error",
    surfaces: ["operationStart"],
    match: "all",
    conditions: [{ field: "workCenter.active", op: "eq", value: true }],
    workCenters: ["Impregnation Oven"]
  }
];

export const BATCH_PROPERTIES: BatchPropertySpec[] = [
  { item: "MAG-NDFB-45", label: "Magnetization lot", dataType: "text" },
  {
    item: "MAG-NDFB-45",
    label: "Coercivity grade",
    dataType: "list",
    listOptions: ["SH", "UH"]
  },
  { item: "MAG-NDFB-38", label: "Magnetization lot", dataType: "text" },
  { item: "MAT-LAM-M19", label: "Coil number", dataType: "text" },
  { item: "MAT-LAM-M19", label: "Core loss (W/kg)", dataType: "numeric" },
  { item: "MAT-CU-18AWG", label: "Spool number", dataType: "text" },
  {
    item: "MAT-CU-18AWG",
    label: "Insulation class",
    dataType: "list",
    listOptions: ["H", "N"]
  }
];

export const motorItems: ItemsData = {
  assembly: motorAssembly,
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
