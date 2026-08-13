import {
  addBomLine,
  addBopOperation,
  createItem,
  type ItemSpec
} from "../helpers/items.ts";
import { insertId, insertRow } from "../sql.ts";
import type { Ctx, ItemRef } from "../types.ts";

// ---------------------------------------------------------------------------
// Satellite item catalog for Orbital Systems Inc.
// Namespace items by type so readableIds can't collide across extension tables.
//   SAT- / BUS- / EPS- / ADCS- / COMMS- / PROP- = Make Parts (Part type)
//   PCB- = Make Parts (PCB subassemblies)
//   BAT- / RW- / ST- / TXRX- / ANT- / THR- / TANK- / VLV- / FST- = Buy Parts
//   MAT- = Materials
//   TL-  = Tools
//   SVC- = Services
//   CN-  = Consumables
// ---------------------------------------------------------------------------

const BUY_PARTS: ItemSpec[] = [
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

const MATERIALS: ItemSpec[] = [
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

const CONSUMABLES: ItemSpec[] = [
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

const TOOLS: ItemSpec[] = [
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

const SERVICES: ItemSpec[] = [
  {
    readableId: "SVC-TVT",
    name: "Thermal Vacuum Test (external)",
    type: "Service",
    replenishment: "Buy",
    standardCost: 8500,
    leadTime: 30
  }
];

// Make parts — BOM/BOP built programmatically below
const MAKE_PARTS: ItemSpec[] = [
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

export async function runTier2(ctx: Ctx): Promise<void> {
  // ── Buy parts ─────────────────────────────────────────────────────────────
  ctx.log("buy parts");
  for (const spec of BUY_PARTS) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── Materials ─────────────────────────────────────────────────────────────
  ctx.log("materials");
  for (const spec of MATERIALS) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── Consumables ───────────────────────────────────────────────────────────
  ctx.log("consumables");
  for (const spec of CONSUMABLES) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── Tools ─────────────────────────────────────────────────────────────────
  ctx.log("tools");
  for (const spec of TOOLS) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── Services ──────────────────────────────────────────────────────────────
  ctx.log("services");
  for (const spec of SERVICES) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── Make parts ────────────────────────────────────────────────────────────
  ctx.log("make parts");
  for (const spec of MAKE_PARTS) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── BOMs and BOPs ─────────────────────────────────────────────────────────
  ctx.log("BOMs and BOPs");
  const i = ctx.refs.items;
  const wc = ctx.refs.workCenters;
  const pr = ctx.refs.processes;

  function need(id: string): ItemRef {
    const ref = i[id];
    if (!ref) throw new Error(`Seed: item "${id}" not in refs`);
    return ref;
  }

  // Fractional per-unit quantities are kept to halves, quarters and eighths.
  // Extended quantity is float multiplication, so 0.05 x 3 renders as
  // 0.15000000000000002 on the shop floor — these values multiply out clean.

  // -- Structural Frame (BUS-STR-001) --
  {
    const mm = needMM(i, "BUS-STR-001");
    await addBomLine(ctx, mm, need("MAT-AL7075-PLT"), 4.5, 1);
    await addBomLine(ctx, mm, need("FST-M4-TI"), 48, 2);
    await addBomLine(ctx, mm, need("FST-M6-A286"), 24, 3);
    await addBomLine(ctx, mm, need("BRG-6201"), 4, 4);
    await addBomLine(ctx, mm, need("CN-GREASE-001"), 0.25, 5);
    await addBopOperation(
      ctx,
      mm,
      pr.Machining!,
      wc["CNC Mill"],
      "Machine structural panels",
      1,
      { laborTime: 4 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr.Welding!,
      wc["TIG Welder Cell"],
      "Weld bracket assemblies",
      2,
      { laborTime: 2 }
    );
    // Sent out to AstroMill for hard anodize between welding and assembly.
    await addBopOperation(
      ctx,
      mm,
      pr["Outside Processing"]!,
      undefined,
      "Hard anodize (Type III) at supplier",
      3,
      {
        operationType: "Outside Processing",
        operationSupplierProcessId:
          ctx.refs.misc["sp:AstroMill Machining:Outside Processing"],
        operationLeadTime: 7,
        operationUnitCost: 240,
        laborTime: 0,
        laborUnit: "Total Hours"
      }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Clean Room Assembly"]!,
      wc["Clean Room Bay A"],
      "Final assembly & torque",
      4,
      {
        laborTime: 3,
        // Gives the MES operation screen an Instructions tab with real steps.
        procedureId: ctx.refs.misc["procedure:Structural Frame Assembly"]
      }
    );
  }

  // -- Solar Array Wing (SAW-001) --
  {
    const mm = needMM(i, "SAW-001");
    await addBomLine(ctx, mm, need("MAT-GAAS-CELL"), 64, 1);
    await addBomLine(ctx, mm, need("MAT-CF-LAM"), 0.75, 2);
    await addBomLine(ctx, mm, need("MAT-KAPTON"), 2.5, 3);
    await addBopOperation(
      ctx,
      mm,
      pr["Composite Layup"]!,
      wc["Clean Room Bay A"],
      "Layup solar array substrate",
      1,
      { laborTime: 6 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Clean Room Assembly"]!,
      wc["Clean Room Bay A"],
      "Bond cells to substrate",
      2,
      { laborTime: 8 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Final Inspection"]!,
      wc["QC Bench"],
      "Electrical test",
      3,
      { laborTime: 2 }
    );
  }

  // -- EPS PCB (PCB-EPS-R1) --
  {
    const mm = needMM(i, "PCB-EPS-R1");
    await addBomLine(ctx, mm, need("PCB-BARE-REV3"), 1, 1);
    await addBomLine(ctx, mm, need("MAT-SYLGARD"), 0.25, 2);
    await addBomLine(ctx, mm, need("MAT-CONFCOAT"), 0.125, 3);
    await addBopOperation(
      ctx,
      mm,
      pr["PCB Assembly"]!,
      wc["PCB Lab"],
      "SMT placement & reflow",
      1,
      { laborTime: 1.5 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Potting & Conformal Coat"]!,
      wc["Potting Station"],
      "Coat and pot",
      2,
      { laborTime: 0.5 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Final Inspection"]!,
      wc["QC Bench"],
      "Flying probe test",
      3,
      { laborTime: 1 }
    );
  }

  // -- ADCS PCB (PCB-ADCS-R1) --
  {
    const mm = needMM(i, "PCB-ADCS-R1");
    await addBomLine(ctx, mm, need("PCB-BARE-REV3"), 1, 1);
    await addBomLine(ctx, mm, need("MAT-CONFCOAT"), 0.125, 2);
    await addBopOperation(
      ctx,
      mm,
      pr["PCB Assembly"]!,
      wc["PCB Lab"],
      "SMT placement & reflow",
      1,
      { laborTime: 1.5 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Potting & Conformal Coat"]!,
      wc["Potting Station"],
      "Conformal coat",
      2,
      { laborTime: 0.25 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Final Inspection"]!,
      wc["QC Bench"],
      "Functional test",
      3,
      { laborTime: 1 }
    );
  }

  // -- EPS Subsystem (EPS-001) --
  {
    const mm = needMM(i, "EPS-001");
    await addBomLine(ctx, mm, need("SAW-001"), 2, 1);
    await addBomLine(ctx, mm, need("BAT-LIION-48V"), 1, 2);
    await addBomLine(ctx, mm, need("PCB-EPS-R1"), 1, 3);
    await addBomLine(ctx, mm, need("MAT-KAPTON"), 1.0, 4);
    await addBopOperation(
      ctx,
      mm,
      pr["Clean Room Assembly"]!,
      wc["Clean Room Bay A"],
      "Integrate solar arrays & battery",
      1,
      { laborTime: 4 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Final Inspection"]!,
      wc["QC Bench"],
      "EPS functional test",
      2,
      { laborTime: 2 }
    );
  }

  // -- ADCS (ADCS-001) --
  {
    const mm = needMM(i, "ADCS-001");
    await addBomLine(ctx, mm, need("RW-010"), 4, 1);
    await addBomLine(ctx, mm, need("ST-050"), 2, 2);
    await addBomLine(ctx, mm, need("PCB-ADCS-R1"), 1, 3);
    await addBomLine(ctx, mm, need("BRG-6201"), 8, 4);
    await addBomLine(ctx, mm, need("FST-M4-TI"), 24, 5);
    await addBopOperation(
      ctx,
      mm,
      pr["Clean Room Assembly"]!,
      wc["Clean Room Bay A"],
      "Install RW and star tracker",
      1,
      { laborTime: 5 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Final Inspection"]!,
      wc["QC Bench"],
      "ADCS functional test",
      2,
      { laborTime: 3 }
    );
  }

  // -- Patch Antenna (ANT-PATCH-01) --
  {
    const mm = needMM(i, "ANT-PATCH-01");
    await addBomLine(ctx, mm, need("MAT-CF-LAM"), 0.125, 1);
    await addBomLine(ctx, mm, need("MAT-KAPTON"), 0.25, 2);
    await addBopOperation(
      ctx,
      mm,
      pr["Composite Layup"]!,
      wc["Clean Room Bay A"],
      "Lay up antenna patch substrate",
      1,
      { laborTime: 2 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Final Inspection"]!,
      wc["QC Bench"],
      "RF performance test",
      2,
      { laborTime: 1 }
    );
  }

  // -- Comms (COMMS-001) --
  {
    const mm = needMM(i, "COMMS-001");
    await addBomLine(ctx, mm, need("TXRX-SBAND"), 1, 1);
    await addBomLine(ctx, mm, need("ANT-PATCH-01"), 2, 2);
    await addBomLine(ctx, mm, need("MAT-KAPTON"), 0.5, 3);
    await addBopOperation(
      ctx,
      mm,
      pr["Clean Room Assembly"]!,
      wc["Clean Room Bay A"],
      "Integrate transponder & antennas",
      1,
      { laborTime: 3 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Final Inspection"]!,
      wc["QC Bench"],
      "End-to-end link test",
      2,
      { laborTime: 2 }
    );
  }

  // -- Propulsion (PROP-001) --
  {
    const mm = needMM(i, "PROP-001");
    await addBomLine(ctx, mm, need("THR-HYDRA-1N"), 2, 1);
    await addBomLine(ctx, mm, need("TANK-TI-4L"), 1, 2);
    await addBomLine(ctx, mm, need("VLV-SOLENOID-LP"), 4, 3);
    await addBomLine(ctx, mm, need("FST-M6-A286"), 16, 4);
    await addBopOperation(
      ctx,
      mm,
      pr["Clean Room Assembly"]!,
      wc["Clean Room Bay A"],
      "Assemble prop module",
      1,
      { laborTime: 6 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Final Inspection"]!,
      wc["QC Bench"],
      "Leak and proof pressure test",
      2,
      { laborTime: 4 }
    );
  }

  // -- Harness (HARNESS-001) --
  {
    const mm = needMM(i, "HARNESS-001");
    await addBomLine(ctx, mm, need("MAT-KAPTON"), 5.0, 1);
    await addBomLine(ctx, mm, need("FST-M4-TI"), 12, 2);
    await addBopOperation(
      ctx,
      mm,
      pr["Clean Room Assembly"]!,
      wc["Clean Room Bay A"],
      "Lay and terminate harness",
      1,
      { laborTime: 8 }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Final Inspection"]!,
      wc["QC Bench"],
      "Continuity & insulation test",
      2,
      { laborTime: 2 }
    );
  }

  // -- Top-level Satellite (SAT-1000) --
  {
    const mm = needMM(i, "SAT-1000");
    await addBomLine(ctx, mm, need("BUS-STR-001"), 1, 1);
    await addBomLine(ctx, mm, need("EPS-001"), 1, 2);
    await addBomLine(ctx, mm, need("ADCS-001"), 1, 3);
    await addBomLine(ctx, mm, need("COMMS-001"), 1, 4);
    await addBomLine(ctx, mm, need("PROP-001"), 1, 5);
    await addBomLine(ctx, mm, need("HARNESS-001"), 1, 6);
    await addBomLine(ctx, mm, need("CN-MLI-001"), 1, 7);
    await addBopOperation(
      ctx,
      mm,
      pr["Clean Room Assembly"]!,
      wc["Clean Room Bay A"],
      "Systems integration",
      1,
      // Assembly (not Process) so the MES routes this operation to the assembly
      // view, where tracked components are scanned into the serial being built.
      {
        laborTime: 16,
        operationType: "Assembly",
        // Gives the MES assembly view its step checklist.
        procedureId: ctx.refs.misc["procedure:Satellite Systems Integration"]
      }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Thermal Vacuum Test"]!,
      wc["TVAC Chamber 1"],
      "TVAC qualification test",
      2,
      {
        laborTime: 72,
        laborUnit: "Total Hours",
        procedureId: ctx.refs.misc["procedure:TVAC Qualification Test"]
      }
    );
    await addBopOperation(
      ctx,
      mm,
      pr["Final Inspection"]!,
      wc["QC Bench"],
      "Acceptance test review",
      3,
      { laborTime: 4 }
    );
  }

  // ── Supplier parts (which supplier can supply what) ────────────────────────
  ctx.log("supplier parts");
  const supplierLinks: Array<{
    supplier: string;
    item: string;
    price: number;
    leadTime: number;
    partId?: string;
  }> = [
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

  for (const sl of supplierLinks) {
    const itemRef = i[sl.item];
    const supplierId = ctx.refs.suppliers[sl.supplier];
    if (!itemRef || !supplierId) continue;

    const spId = await insertId(ctx, "supplierPart", {
      itemId: itemRef.id,
      supplierId,
      unitPrice: sl.price,
      minimumOrderQuantity: 1
    });
    await insertRow(ctx, "supplierPartPrice", {
      supplierPartId: spId,
      quantity: 1,
      unitPrice: sl.price,
      leadTime: sl.leadTime,
      sourceType: "Manual Entry"
    });
  }
}

function needMM(items: Record<string, ItemRef>, readableId: string): string {
  const ref = items[readableId];
  if (!ref) throw new Error(`Seed: item "${readableId}" not in refs`);
  if (!ref.makeMethodId)
    throw new Error(`Seed: item "${readableId}" has no makeMethodId`);
  return ref.makeMethodId;
}
