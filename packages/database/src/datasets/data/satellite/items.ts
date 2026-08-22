import type { ItemSpec } from "../../helpers/items.ts";
import type {
  ItemsData,
  MakeMethodSpec,
  SupplierLinkSpec
} from "../../types.ts";

// ---------------------------------------------------------------------------
// Satellite item catalog for Orbital Systems Inc.
// Namespace items by type so readableIds can't collide across extension tables.
//   Make Parts: SAT- / BUS- / EPS- / ADCS- / COMMS- / PROP- / SAW- / ANT- /
//               HARNESS- / PCB-EPS- / PCB-ADCS-
//   Buy Parts:  BAT- / RW- / ST- / TXRX- / THR- / TANK- / VLV- / FST- / BRG- /
//               PCB-BARE-
//   MAT- = Materials, TL- = Tools, SVC- = Services, CN- = Consumables
// PCB- spans both: the bare board is bought, the populated assemblies are made.
// ---------------------------------------------------------------------------

export const BUY_PARTS: ItemSpec[] = [
  // Electronics
  {
    readableId: "BAT-LIION-48V",
    name: "Li-Ion Battery Pack 48V 100Wh",
    type: "Part",
    replenishment: "Buy",
    // Batch-tracked: receiving captures a lot, and the lot is what gets scanned
    // into an assembly on the floor.
    trackingType: "Batch",
    standardCost: 2400,
    unitSalePrice: 3600,
    leadTime: 60
  },
  {
    readableId: "PCB-BARE-REV3",
    name: "Bare PCB Rev3 (4-layer)",
    type: "Part",
    replenishment: "Buy",
    standardCost: 85,
    leadTime: 21
  },
  {
    readableId: "RW-010",
    name: "Reaction Wheel 0.010 Nm",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Serial",
    standardCost: 14500,
    unitSalePrice: 21750,
    leadTime: 90
  },
  {
    readableId: "ST-050",
    name: "Star Tracker 0.5 arcsec",
    type: "Part",
    replenishment: "Buy",
    standardCost: 28000,
    unitSalePrice: 42000,
    leadTime: 120
  },
  {
    readableId: "TXRX-SBAND",
    name: "S-Band Transponder 2W",
    type: "Part",
    replenishment: "Buy",
    standardCost: 9500,
    unitSalePrice: 14250,
    leadTime: 90
  },
  // Propulsion
  {
    readableId: "THR-HYDRA-1N",
    name: "Hydrazine Thruster 1N",
    type: "Part",
    replenishment: "Buy",
    standardCost: 6800,
    unitSalePrice: 10200,
    leadTime: 120
  },
  {
    readableId: "TANK-TI-4L",
    name: "Titanium Propellant Tank 4L",
    type: "Part",
    replenishment: "Buy",
    standardCost: 3200,
    unitSalePrice: 4800,
    leadTime: 60
  },
  {
    readableId: "VLV-SOLENOID-LP",
    name: "Solenoid Valve Low-Pressure",
    type: "Part",
    replenishment: "Buy",
    standardCost: 950,
    unitSalePrice: 1425,
    leadTime: 45
  },
  // Structural buy parts
  {
    readableId: "FST-M4-TI",
    name: "M4 x 8 Titanium Fastener",
    type: "Part",
    replenishment: "Buy",
    standardCost: 2.5,
    unitSalePrice: 4,
    leadTime: 14
  },
  {
    readableId: "FST-M6-A286",
    name: "M6 x 10 A286 Fastener",
    type: "Part",
    replenishment: "Buy",
    standardCost: 5.5,
    unitSalePrice: 8,
    leadTime: 14
  },
  {
    readableId: "BRG-6201",
    name: "Deep Groove Ball Bearing 6201",
    type: "Part",
    replenishment: "Buy",
    standardCost: 18,
    unitSalePrice: 27,
    leadTime: 10
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
    readableId: "MAT-CF-LAM",
    name: "Carbon Fiber Laminate Sheet 1mm",
    type: "Material",
    standardCost: 320,
    unitOfMeasureCode: "EA",
    leadTime: 21
  },
  {
    readableId: "MAT-GAAS-CELL",
    name: "Triple-Junction GaAs Solar Cell",
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
    leadTime: 7
  },
  {
    readableId: "MAT-SYLGARD",
    name: "Sylgard 184 Silicone Potting",
    type: "Material",
    standardCost: 95,
    unitOfMeasureCode: "LB",
    leadTime: 7
  },
  {
    readableId: "MAT-CONFCOAT",
    name: "Conformal Coat Acrylic 400mL",
    type: "Material",
    standardCost: 62,
    unitOfMeasureCode: "EA",
    leadTime: 5
  }
];

export const CONSUMABLES: ItemSpec[] = [
  {
    readableId: "CN-MLI-001",
    name: "MLI Blanket Kit (pre-cut)",
    type: "Consumable",
    standardCost: 380,
    leadTime: 14
  },
  {
    readableId: "CN-GREASE-001",
    name: "Krytox 240 AC Lubricant",
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
    readableId: "TL-PROBE-VNA",
    name: "VNA Cable Calibration Kit",
    type: "Tool",
    standardCost: 2800
  }
];

export const SERVICES: ItemSpec[] = [
  {
    readableId: "SVC-TVT",
    name: "Thermal Vacuum Test (external)",
    type: "Service",
    replenishment: "Buy",
    standardCost: 8500,
    leadTime: 30
  }
];

// Make parts — BOM/BOP built programmatically in the tier
export const MAKE_PARTS: ItemSpec[] = [
  {
    readableId: "SAT-1000",
    name: "ESPA-Class Smallsat Bus (Complete)",
    type: "Part",
    replenishment: "Make",
    // Serial-tracked: each satellite gets its own genealogy in traceability.
    trackingType: "Serial",
    standardCost: 0,
    unitSalePrice: 1800000
  },
  {
    readableId: "BUS-STR-001",
    name: "Structural Frame Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 45000
  },
  {
    readableId: "EPS-001",
    name: "Electrical Power Subsystem",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 120000
  },
  {
    readableId: "SAW-001",
    name: "Solar Array Wing",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 35000
  },
  {
    readableId: "PCB-EPS-R1",
    name: "EPS Control PCB Assembly",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 4200
  },
  {
    readableId: "ADCS-001",
    name: "Attitude Determination & Control System",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 95000
  },
  {
    readableId: "PCB-ADCS-R1",
    name: "ADCS Electronics Board",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 5800
  },
  {
    readableId: "COMMS-001",
    name: "Communications Subsystem",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 28000
  },
  {
    readableId: "ANT-PATCH-01",
    name: "Patch Antenna S-Band",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 1800
  },
  {
    readableId: "PROP-001",
    name: "Propulsion Module",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 38000
  },
  {
    readableId: "HARNESS-001",
    name: "Spacecraft Wiring Harness",
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 12000
  }
];

// BOMs and BOPs, in the order they are inserted.
// Fractional per-unit quantities are kept to halves, quarters and eighths.
// Extended quantity is float multiplication, so 0.05 x 3 renders as
// 0.15000000000000002 on the shop floor — these values multiply out clean.
export const METHODS: MakeMethodSpec[] = [
  {
    readableId: "BUS-STR-001",
    bom: [
      { component: "MAT-AL7075-PLT", quantity: 4.5, order: 1 },
      { component: "FST-M4-TI", quantity: 48, order: 2 },
      { component: "FST-M6-A286", quantity: 24, order: 3 },
      { component: "BRG-6201", quantity: 4, order: 4 },
      { component: "CN-GREASE-001", quantity: 0.25, order: 5 }
    ],
    bop: [
      {
        process: "Machining",
        workCenter: "CNC Mill",
        description: "Machine structural panels",
        order: 1,
        laborTime: 4
      },
      {
        process: "Welding",
        workCenter: "TIG Welder Cell",
        description: "Weld bracket assemblies",
        order: 2,
        laborTime: 2
      },
      // Sent out to AstroMill for hard anodize between welding and assembly.
      {
        process: "Outside Processing",
        description: "Hard anodize (Type III) at supplier",
        order: 3,
        operationType: "Outside Processing",
        supplierProcess: "sp:AstroMill Machining:Outside Processing",
        operationLeadTime: 7,
        operationUnitCost: 240,
        laborTime: 0,
        laborUnit: "Total Hours"
      },
      {
        process: "Clean Room Assembly",
        workCenter: "Clean Room Bay A",
        description: "Final assembly & torque",
        order: 4,
        laborTime: 3,
        // Gives the MES operation screen an Instructions tab with real steps.
        procedure: "procedure:Structural Frame Assembly"
      }
    ]
  },
  {
    readableId: "SAW-001",
    bom: [
      { component: "MAT-GAAS-CELL", quantity: 64, order: 1 },
      { component: "MAT-CF-LAM", quantity: 0.75, order: 2 },
      { component: "MAT-KAPTON", quantity: 2.5, order: 3 }
    ],
    bop: [
      {
        process: "Composite Layup",
        workCenter: "Clean Room Bay A",
        description: "Layup solar array substrate",
        order: 1,
        laborTime: 6
      },
      {
        process: "Clean Room Assembly",
        workCenter: "Clean Room Bay A",
        description: "Bond cells to substrate",
        order: 2,
        laborTime: 8
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Electrical test",
        order: 3,
        laborTime: 2
      }
    ]
  },
  {
    readableId: "PCB-EPS-R1",
    bom: [
      { component: "PCB-BARE-REV3", quantity: 1, order: 1 },
      { component: "MAT-SYLGARD", quantity: 0.25, order: 2 },
      { component: "MAT-CONFCOAT", quantity: 0.125, order: 3 }
    ],
    bop: [
      {
        process: "PCB Assembly",
        workCenter: "PCB Lab",
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
        laborTime: 1
      }
    ]
  },
  {
    readableId: "PCB-ADCS-R1",
    bom: [
      { component: "PCB-BARE-REV3", quantity: 1, order: 1 },
      { component: "MAT-CONFCOAT", quantity: 0.125, order: 2 }
    ],
    bop: [
      {
        process: "PCB Assembly",
        workCenter: "PCB Lab",
        description: "SMT placement & reflow",
        order: 1,
        laborTime: 1.5
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
    readableId: "EPS-001",
    bom: [
      { component: "SAW-001", quantity: 2, order: 1 },
      { component: "BAT-LIION-48V", quantity: 1, order: 2 },
      { component: "PCB-EPS-R1", quantity: 1, order: 3 },
      { component: "MAT-KAPTON", quantity: 1.0, order: 4 }
    ],
    bop: [
      {
        process: "Clean Room Assembly",
        workCenter: "Clean Room Bay A",
        description: "Integrate solar arrays & battery",
        order: 1,
        laborTime: 4
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "EPS functional test",
        order: 2,
        laborTime: 2
      }
    ]
  },
  {
    readableId: "ADCS-001",
    bom: [
      { component: "RW-010", quantity: 4, order: 1 },
      { component: "ST-050", quantity: 2, order: 2 },
      { component: "PCB-ADCS-R1", quantity: 1, order: 3 },
      { component: "BRG-6201", quantity: 8, order: 4 },
      { component: "FST-M4-TI", quantity: 24, order: 5 }
    ],
    bop: [
      {
        process: "Clean Room Assembly",
        workCenter: "Clean Room Bay A",
        description: "Install RW and star tracker",
        order: 1,
        laborTime: 5
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "ADCS functional test",
        order: 2,
        laborTime: 3
      }
    ]
  },
  {
    readableId: "ANT-PATCH-01",
    bom: [
      { component: "MAT-CF-LAM", quantity: 0.125, order: 1 },
      { component: "MAT-KAPTON", quantity: 0.25, order: 2 }
    ],
    bop: [
      {
        process: "Composite Layup",
        workCenter: "Clean Room Bay A",
        description: "Lay up antenna patch substrate",
        order: 1,
        laborTime: 2
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "RF performance test",
        order: 2,
        laborTime: 1
      }
    ]
  },
  {
    readableId: "COMMS-001",
    bom: [
      { component: "TXRX-SBAND", quantity: 1, order: 1 },
      { component: "ANT-PATCH-01", quantity: 2, order: 2 },
      { component: "MAT-KAPTON", quantity: 0.5, order: 3 }
    ],
    bop: [
      {
        process: "Clean Room Assembly",
        workCenter: "Clean Room Bay A",
        description: "Integrate transponder & antennas",
        order: 1,
        laborTime: 3
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "End-to-end link test",
        order: 2,
        laborTime: 2
      }
    ]
  },
  {
    readableId: "PROP-001",
    bom: [
      { component: "THR-HYDRA-1N", quantity: 2, order: 1 },
      { component: "TANK-TI-4L", quantity: 1, order: 2 },
      { component: "VLV-SOLENOID-LP", quantity: 4, order: 3 },
      { component: "FST-M6-A286", quantity: 16, order: 4 }
    ],
    bop: [
      {
        process: "Clean Room Assembly",
        workCenter: "Clean Room Bay A",
        description: "Assemble prop module",
        order: 1,
        laborTime: 6
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Leak and proof pressure test",
        order: 2,
        laborTime: 4
      }
    ]
  },
  {
    readableId: "HARNESS-001",
    bom: [
      { component: "MAT-KAPTON", quantity: 5.0, order: 1 },
      { component: "FST-M4-TI", quantity: 12, order: 2 }
    ],
    bop: [
      {
        process: "Clean Room Assembly",
        workCenter: "Clean Room Bay A",
        description: "Lay and terminate harness",
        order: 1,
        laborTime: 8
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
        description: "Continuity & insulation test",
        order: 2,
        laborTime: 2
      }
    ]
  },
  {
    readableId: "SAT-1000",
    bom: [
      { component: "BUS-STR-001", quantity: 1, order: 1 },
      { component: "EPS-001", quantity: 1, order: 2 },
      { component: "ADCS-001", quantity: 1, order: 3 },
      { component: "COMMS-001", quantity: 1, order: 4 },
      { component: "PROP-001", quantity: 1, order: 5 },
      { component: "HARNESS-001", quantity: 1, order: 6 },
      { component: "CN-MLI-001", quantity: 1, order: 7 }
    ],
    bop: [
      // Assembly (not Process) so the MES routes this operation to the assembly
      // view, where tracked components are scanned into the serial being built.
      {
        process: "Clean Room Assembly",
        workCenter: "Clean Room Bay A",
        description: "Systems integration",
        order: 1,
        laborTime: 16,
        operationType: "Assembly",
        // Gives the MES assembly view its step checklist.
        procedure: "procedure:Satellite Systems Integration"
      },
      {
        process: "Thermal Vacuum Test",
        workCenter: "TVAC Chamber 1",
        description: "TVAC qualification test",
        order: 2,
        laborTime: 72,
        laborUnit: "Total Hours",
        procedure: "procedure:TVAC Qualification Test"
      },
      {
        process: "Final Inspection",
        workCenter: "QC Bench",
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
    supplier: "CelestialElex",
    item: "PCB-BARE-REV3",
    price: 85,
    leadTime: 21
  },
  {
    supplier: "CelestialElex",
    item: "BAT-LIION-48V",
    price: 2400,
    leadTime: 60
  },
  {
    supplier: "CelestialElex",
    item: "TXRX-SBAND",
    price: 9500,
    leadTime: 90
  },
  {
    supplier: "SpaceGrade Fasteners",
    item: "FST-M4-TI",
    price: 2.5,
    leadTime: 14
  },
  {
    supplier: "SpaceGrade Fasteners",
    item: "FST-M6-A286",
    price: 5.5,
    leadTime: 14
  },
  {
    supplier: "SpaceGrade Fasteners",
    item: "BRG-6201",
    price: 18,
    leadTime: 10
  },
  {
    supplier: "Orbital Composites",
    item: "MAT-CF-LAM",
    price: 320,
    leadTime: 21
  },
  {
    supplier: "Orbital Composites",
    item: "MAT-AL7075-PLT",
    price: 12,
    leadTime: 10
  },
  {
    supplier: "PropTech Solutions",
    item: "THR-HYDRA-1N",
    price: 6800,
    leadTime: 120
  },
  {
    supplier: "PropTech Solutions",
    item: "TANK-TI-4L",
    price: 3200,
    leadTime: 60
  },
  {
    supplier: "PropTech Solutions",
    item: "VLV-SOLENOID-LP",
    price: 950,
    leadTime: 45
  },
  { supplier: "Deep Space RF", item: "RW-010", price: 14500, leadTime: 90 },
  { supplier: "Deep Space RF", item: "ST-050", price: 28000, leadTime: 120 }
];

export const satelliteItems: ItemsData = {
  buyParts: BUY_PARTS,
  materials: MATERIALS,
  consumables: CONSUMABLES,
  tools: TOOLS,
  services: SERVICES,
  makeParts: MAKE_PARTS,
  methods: METHODS,
  supplierLinks: SUPPLIER_LINKS
};
