import { insertId, insertRow, one, RICH, rows } from "../sql.ts";
import type { Ctx } from "../types.ts";

type ProcedureStepSpec = {
  name: string;
  type: "Task" | "Checkbox" | "Measurement" | "Value" | "List" | "Person";
  instruction: string;
  required?: boolean;
  unitOfMeasureCode?: string;
  minValue?: number;
  maxValue?: number;
};

type ProcedureSpec = {
  name: string;
  process: string;
  description: string;
  versions: Array<{
    version: number;
    status: "Draft" | "Active" | "Archived";
    steps: ProcedureStepSpec[];
  }>;
};

// ---------------------------------------------------------------------------
// Satellites / spacecraft theme — Orbital Systems Inc.
// ---------------------------------------------------------------------------

const DEPT_NAMES = ["Engineering", "Manufacturing", "Quality", "Supply Chain"];
const ABILITIES = [
  "CNC Operation",
  "Welding",
  "Clean Room Assembly",
  "PCB Rework",
  "Inspection",
  "Composite Layup"
];
const PROCESSES = [
  { name: "Machining", factor: "Minutes/Piece", type: "Process" },
  { name: "Welding", factor: "Minutes/Piece", type: "Process" },
  { name: "Clean Room Assembly", factor: "Hours/Piece", type: "Assembly" },
  { name: "PCB Assembly", factor: "Minutes/Piece", type: "Process" },
  { name: "Composite Layup", factor: "Hours/Piece", type: "Process" },
  { name: "Thermal Vacuum Test", factor: "Total Hours", type: "Inspection" },
  {
    name: "Potting & Conformal Coat",
    factor: "Minutes/Piece",
    type: "Process"
  },
  { name: "Final Inspection", factor: "Hours/Piece", type: "Inspection" },
  { name: "Outside Processing", factor: "Total Hours", type: "Process" }
];

const WORK_CENTERS = [
  {
    name: "CNC Mill",
    dept: "Manufacturing",
    ability: "CNC Operation",
    laborRate: 85,
    machineRate: 120
  },
  {
    name: "TIG Welder Cell",
    dept: "Manufacturing",
    ability: "Welding",
    laborRate: 75,
    machineRate: 30
  },
  {
    name: "Clean Room Bay A",
    dept: "Manufacturing",
    ability: "Clean Room Assembly",
    laborRate: 95,
    machineRate: 0
  },
  {
    name: "PCB Lab",
    dept: "Manufacturing",
    ability: "PCB Rework",
    laborRate: 90,
    machineRate: 45
  },
  {
    name: "TVAC Chamber 1",
    dept: "Manufacturing",
    ability: "Inspection",
    laborRate: 70,
    machineRate: 200
  },
  {
    name: "QC Bench",
    dept: "Quality",
    ability: "Inspection",
    laborRate: 70,
    machineRate: 0
  },
  {
    name: "Potting Station",
    dept: "Manufacturing",
    ability: "Clean Room Assembly",
    laborRate: 65,
    machineRate: 20
  }
];

const CUSTOMERS = [
  {
    name: "ORBSEC Defense",
    type: "Government",
    status: "Active",
    phone: "+1-703-555-0100",
    website: "https://orbsec.gov"
  },
  {
    name: "NovaSat Networks",
    type: "Commercial",
    status: "Active",
    phone: "+1-415-555-0200",
    website: "https://novasat.com"
  },
  {
    name: "Apex Space Research",
    type: "Research",
    status: "Active",
    phone: "+1-617-555-0300",
    website: "https://apexresearch.edu"
  },
  {
    name: "PolarView Earth",
    type: "Commercial",
    status: "Lead",
    phone: "+1-512-555-0400",
    website: "https://polarview.io"
  }
];

const CUSTOMER_CONTACTS = [
  {
    customer: "ORBSEC Defense",
    firstName: "Marcus",
    lastName: "Reyes",
    email: "m.reyes@orbsec.gov",
    title: "Contracts Officer"
  },
  {
    customer: "NovaSat Networks",
    firstName: "Priya",
    lastName: "Shah",
    email: "pshah@novasat.com",
    title: "VP Supply Chain"
  },
  {
    customer: "Apex Space Research",
    firstName: "Dr. James",
    lastName: "Okonkwo",
    email: "jokonkwo@apexresearch.edu",
    title: "Program Lead"
  },
  {
    customer: "PolarView Earth",
    firstName: "Sofia",
    lastName: "Lindqvist",
    email: "sofia@polarview.io",
    title: "CTO"
  }
];

const SUPPLIERS = [
  {
    name: "CelestialElex",
    type: "Electronics",
    phone: "+1-408-555-0500",
    website: "https://celestialex.com"
  },
  {
    name: "SpaceGrade Fasteners",
    type: "Hardware",
    phone: "+1-206-555-0600",
    website: "https://sgfasteners.com"
  },
  {
    name: "Orbital Composites",
    type: "Materials",
    phone: "+1-714-555-0700",
    website: "https://orbcomp.com"
  },
  {
    name: "PropTech Solutions",
    type: "Propulsion",
    phone: "+1-310-555-0800",
    website: "https://proptech.space"
  },
  {
    name: "Deep Space RF",
    type: "Electronics",
    phone: "+1-303-555-0900",
    website: "https://dsrf.com"
  },
  {
    name: "AstroMill Machining",
    type: "Contract Manufacturer",
    phone: "+1-972-555-1000",
    website: "https://astromill.com"
  }
];

const SUPPLIER_CONTACTS = [
  {
    supplier: "CelestialElex",
    firstName: "Wei",
    lastName: "Chen",
    email: "w.chen@celestialex.com",
    title: "Account Manager"
  },
  {
    supplier: "SpaceGrade Fasteners",
    firstName: "Lena",
    lastName: "Hofer",
    email: "lhofer@sgfasteners.com",
    title: "Sales Rep"
  },
  {
    supplier: "Orbital Composites",
    firstName: "Carlos",
    lastName: "Mendez",
    email: "cmendez@orbcomp.com",
    title: "Technical Sales"
  },
  {
    supplier: "PropTech Solutions",
    firstName: "Yuki",
    lastName: "Tanaka",
    email: "ytanaka@proptech.space",
    title: "Program Manager"
  },
  {
    supplier: "Deep Space RF",
    firstName: "Amara",
    lastName: "Osei",
    email: "aosei@dsrf.com",
    title: "Sales Director"
  },
  {
    supplier: "AstroMill Machining",
    firstName: "Deron",
    lastName: "Brooks",
    email: "dbrooks@astromill.com",
    title: "Account Rep"
  }
];

// Supplier processes for the contract manufacturer
const SUPPLIER_PROCESSES = [
  { supplier: "AstroMill Machining", process: "Machining" },
  { supplier: "AstroMill Machining", process: "Welding" },
  // Backs the outside-processing (anodize) step on the structural frame.
  { supplier: "AstroMill Machining", process: "Outside Processing" }
];

const STRUCTURAL_STEPS_V2: ProcedureStepSpec[] = [
  {
    name: "Verify panel kit against the pick list",
    type: "Checkbox",
    instruction:
      "Confirm all six machined panels and both bracket sets are present and match the drawing revision on the traveler."
  },
  {
    name: "Torque corner fasteners",
    type: "Measurement",
    instruction:
      "Torque the M6 corner fasteners in a star pattern. Record the final torque wrench reading.",
    unitOfMeasureCode: "EA",
    minValue: 8,
    maxValue: 10
  },
  {
    name: "Measure diagonal squareness",
    type: "Measurement",
    instruction:
      "Measure both diagonals across the frame. The difference must stay inside 0.5 mm.",
    unitOfMeasureCode: "EA",
    minValue: 0,
    maxValue: 0.5
  },
  {
    name: "Record assembler",
    type: "Person",
    instruction: "Sign off as the assembler responsible for this frame."
  },
  {
    name: "Bag and label for clean room transfer",
    type: "Task",
    instruction:
      "Bag the frame in ESD-safe film, apply the job label, and stage it on the clean room transfer cart.",
    required: false
  }
];

const PROCEDURES: ProcedureSpec[] = [
  {
    name: "Structural Frame Assembly",
    process: "Clean Room Assembly",
    description:
      "Assembly and torque procedure for the ESPA-class structural frame.",
    versions: [
      {
        version: 1,
        status: "Archived",
        steps: [
          {
            name: "Verify panel kit against the pick list",
            type: "Checkbox",
            instruction: "Confirm all machined panels are present."
          },
          {
            name: "Torque corner fasteners",
            type: "Measurement",
            instruction:
              "Torque the M6 corner fasteners in a star pattern to 9 Nm.",
            unitOfMeasureCode: "EA",
            minValue: 8.5,
            maxValue: 9.5
          }
        ]
      },
      { version: 2, status: "Active", steps: STRUCTURAL_STEPS_V2 }
    ]
  },
  {
    name: "Satellite Systems Integration",
    process: "Clean Room Assembly",
    description:
      "Clean room integration of the bus subsystems into the SAT-1000 airframe.",
    versions: [
      {
        version: 1,
        status: "Active",
        steps: [
          {
            name: "Stage subsystems in the clean room",
            type: "Checkbox",
            instruction:
              "Move the structural frame, power subsystem, avionics stack, comms payload and propulsion module into Bay A and confirm each serial against the traveler."
          },
          {
            name: "Mate avionics stack to the frame",
            type: "Task",
            instruction:
              "Seat the avionics stack on its rails, engage the captive fasteners and confirm the ground strap is bonded."
          },
          {
            name: "Route and dress the harness",
            type: "Checkbox",
            instruction:
              "Route HARNESS-001 through the frame raceways, tie at every bracket and confirm no connector is under strain."
          },
          {
            name: "Measure stowed mass",
            type: "Measurement",
            instruction:
              "Weigh the integrated bus with the wings stowed and record the mass in pounds.",
            unitOfMeasureCode: "LB",
            minValue: 305,
            maxValue: 335
          },
          {
            name: "Record integration lead",
            type: "Person",
            instruction:
              "Sign off as the integration lead responsible for this bus."
          }
        ]
      }
    ]
  },
  {
    name: "TVAC Qualification Test",
    process: "Thermal Vacuum Test",
    description:
      "Thermal vacuum qualification cycle for an integrated satellite bus.",
    versions: [
      {
        version: 1,
        status: "Active",
        steps: [
          {
            name: "Install harness and thermocouples",
            type: "Task",
            instruction:
              "Route the test harness through the chamber feedthrough and bond thermocouples to the four survey points."
          },
          {
            name: "Pump down to test pressure",
            type: "Measurement",
            instruction:
              "Pump the chamber down and record the pressure once it stabilises.",
            unitOfMeasureCode: "EA",
            minValue: 0,
            maxValue: 0.00001
          },
          {
            name: "Run eight thermal cycles",
            type: "Checkbox",
            instruction:
              "Cycle between -20 C and +60 C, dwelling one hour at each extreme. Tick once all eight cycles complete."
          },
          {
            name: "Functional check at hot soak",
            type: "Checkbox",
            instruction:
              "Command the bus through the functional script during the final hot dwell and confirm all telemetry is nominal."
          }
        ]
      }
    ]
  }
];

const SHIPPING_METHODS = [
  "UPS Ground",
  "UPS 2nd Day Air",
  "FedEx Priority Overnight",
  "Will Call",
  "Freight"
];
const SHIPPING_TERMS = [
  "FOB Origin",
  "FOB Destination",
  "Net 30 EOM",
  "Prepaid & Add"
];

const ITEM_POSTING_GROUPS = [
  "Raw Material",
  "Finished Goods",
  "WIP",
  "Supplies",
  "Service Items"
];

export async function runTier1(ctx: Ctx): Promise<void> {
  const { client, companyId, locationId } = ctx;

  // ── Departments ──────────────────────────────────────────────────────────
  ctx.log("departments");
  for (const name of DEPT_NAMES) {
    const id = await insertId(ctx, "department", { name });
    ctx.refs.departments[name] = id;
  }

  // ── Shifts ────────────────────────────────────────────────────────────────
  ctx.log("shifts");
  ctx.refs.shifts.Day = await insertId(ctx, "shift", {
    name: "Day Shift",
    startTime: "06:00:00",
    endTime: "14:30:00",
    locationId,
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true
  });
  ctx.refs.shifts.Swing = await insertId(ctx, "shift", {
    name: "Swing Shift",
    startTime: "14:30:00",
    endTime: "23:00:00",
    locationId,
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true
  });

  // ── Abilities ─────────────────────────────────────────────────────────────
  ctx.log("abilities");
  for (const name of ABILITIES) {
    ctx.refs.abilities[name] = await insertId(ctx, "ability", { name });
  }

  // ── Processes ─────────────────────────────────────────────────────────────
  ctx.log("processes");
  for (const p of PROCESSES) {
    ctx.refs.processes[p.name] = await insertId(ctx, "process", {
      name: p.name,
      defaultStandardFactor: p.factor,
      processType: p.type
    });
  }

  // ── Item posting groups ───────────────────────────────────────────────────
  ctx.log("item posting groups");
  for (const name of ITEM_POSTING_GROUPS) {
    ctx.refs.misc[`ipg:${name}`] = await insertId(ctx, "itemPostingGroup", {
      name
    });
  }

  // ── Second location (manufacturing plant) ─────────────────────────────────
  ctx.log("manufacturing location");
  const plantId = await insertId(ctx, "location", {
    name: "Manufacturing Plant",
    addressLine1: "4500 Space Commerce Drive",
    city: "Houston",
    stateProvince: "TX",
    postalCode: "77058",
    countryCode: "US",
    timezone: "America/Chicago"
  });
  ctx.refs.locations.Plant = plantId;
  ctx.refs.locations.HQ = locationId;

  // Every job and work center lives at the plant, and both the MES board and
  // the ERP's location-scoped pages read the signed-in user's default location.
  // Leave that at HQ and the shop floor renders empty.
  await ctx.client.query(
    `UPDATE "employeeJob" SET "locationId" = $2 WHERE "companyId" = $1`,
    [ctx.companyId, plantId]
  );
  // (`userDefaults` is a view over employeeJob — the UPDATE above is what moves it.)

  // ── Warehouses ────────────────────────────────────────────────────────────
  ctx.log("warehouses");
  ctx.refs.warehouses.Main = await insertId(ctx, "warehouse", {
    name: "Main Warehouse",
    locationId: plantId,
    requiresPick: true,
    requiresPutAway: true,
    requiresBin: true
  });
  ctx.refs.warehouses.RMA = await insertId(ctx, "warehouse", {
    name: "RMA / Return",
    locationId: plantId
  });
  ctx.refs.warehouses.QC = await insertId(ctx, "warehouse", {
    name: "QC Hold",
    locationId: plantId,
    requiresBin: true
  });

  // ── Storage types ─────────────────────────────────────────────────────────
  ctx.log("storage types + units");
  const stShelf = await insertId(ctx, "storageType", { name: "Shelf" });
  const stBin = await insertId(ctx, "storageType", { name: "Bin" });
  const stRack = await insertId(ctx, "storageType", { name: "Rack" });

  // Top-level shelves (racking rows), then child bins
  const aisleA = await insertId(ctx, "storageUnit", {
    name: "Aisle-A",
    locationId: plantId,
    warehouseId: ctx.refs.warehouses.Main,
    storageTypeIds: [stRack],
    active: true
  });
  ctx.refs.shelves["Aisle-A"] = aisleA;

  for (let row = 1; row <= 3; row++) {
    for (const level of ["L1", "L2", "L3"]) {
      const binName = `A${row}-${level}`;
      const binId = await insertId(ctx, "storageUnit", {
        name: binName,
        locationId: plantId,
        warehouseId: ctx.refs.warehouses.Main,
        parentId: aisleA,
        storageTypeIds: [stBin]
      });
      ctx.refs.shelves[binName] = binId;
    }
  }

  const cleanRoomShelf = await insertId(ctx, "storageUnit", {
    name: "Clean Room Shelf",
    locationId: plantId,
    warehouseId: ctx.refs.warehouses.Main,
    storageTypeIds: [stShelf]
  });
  ctx.refs.shelves.CleanRoom = cleanRoomShelf;

  // ── Work centers (need dept + ability + location) ─────────────────────────
  ctx.log("work centers");
  for (const wc of WORK_CENTERS) {
    const id = await insertId(ctx, "workCenter", {
      name: wc.name,
      departmentId: ctx.refs.departments[wc.dept],
      requiredAbilityId: ctx.refs.abilities[wc.ability],
      locationId: plantId,
      laborRate: wc.laborRate,
      machineRate: wc.machineRate
    });
    ctx.refs.workCenters[wc.name] = id;
  }

  // Link work centers to processes
  const wcProcessLinks: Array<[string, string]> = [
    ["CNC Mill", "Machining"],
    ["TIG Welder Cell", "Welding"],
    ["Clean Room Bay A", "Clean Room Assembly"],
    ["PCB Lab", "PCB Assembly"],
    ["TVAC Chamber 1", "Thermal Vacuum Test"],
    ["QC Bench", "Final Inspection"],
    ["Potting Station", "Potting & Conformal Coat"]
  ];
  for (const [wc, proc] of wcProcessLinks) {
    await insertRow(ctx, "workCenterProcess", {
      workCenterId: ctx.refs.workCenters[wc],
      processId: ctx.refs.processes[proc]
    });
  }

  // Storage units for work centers (for floor-level inventory)
  for (const wc of WORK_CENTERS) {
    const suId = await insertId(ctx, "storageUnit", {
      name: `${wc.name} Floor`,
      locationId: plantId,
      workCenterId: ctx.refs.workCenters[wc.name],
      isWorkCenterDefault: true
    });
    ctx.refs.shelves[`wc:${wc.name}`] = suId;
  }

  // ── Customer types ────────────────────────────────────────────────────────
  ctx.log("customer types");
  for (const name of ["Government", "Commercial", "Research", "Internal"]) {
    ctx.refs.misc[`ctype:${name}`] = await insertId(ctx, "customerType", {
      name
    });
  }

  // ── Supplier types ────────────────────────────────────────────────────────
  ctx.log("supplier types");
  for (const name of [
    "Electronics",
    "Hardware",
    "Materials",
    "Propulsion",
    "Contract Manufacturer",
    "Services"
  ]) {
    ctx.refs.misc[`stype:${name}`] = await insertId(ctx, "supplierType", {
      name
    });
  }

  // ── Shipping methods ──────────────────────────────────────────────────────
  ctx.log("shipping methods");
  for (const name of SHIPPING_METHODS) {
    const carrier = name.startsWith("UPS")
      ? "UPS"
      : name.startsWith("FedEx")
        ? "FedEx"
        : "Other";
    ctx.refs.shippingMethods[name] = await insertId(ctx, "shippingMethod", {
      name,
      carrier
    });
  }

  // ── Shipping terms ────────────────────────────────────────────────────────
  ctx.log("shipping terms");
  for (const name of SHIPPING_TERMS) {
    ctx.refs.misc[`sterm:${name}`] = await insertId(ctx, "shippingTerm", {
      name
    });
  }

  // ── Payment term id ───────────────────────────────────────────────────────
  const netThirty = await one<{ id: string }>(
    client,
    `SELECT id FROM "paymentTerm" WHERE "companyId" = $1 AND name ILIKE '%net%30%' LIMIT 1`,
    [companyId]
  );
  ctx.refs.misc.paymentTermId = netThirty.id;

  // ── Customer status ids ───────────────────────────────────────────────────
  const statuses = await rows<{ id: string; name: string }>(
    client,
    `SELECT id, name FROM "customerStatus" WHERE "companyId" = $1`,
    [companyId]
  );
  for (const s of statuses) ctx.refs.misc[`cstatus:${s.name}`] = s.id;

  // ── Customers ─────────────────────────────────────────────────────────────
  ctx.log("customers");
  for (const c of CUSTOMERS) {
    const statusId = ctx.refs.misc[`cstatus:${c.status}`];
    const typeId = ctx.refs.misc[`ctype:${c.type}`];
    const custId = await insertId(ctx, "customer", {
      name: c.name,
      customerTypeId: typeId,
      customerStatusId: statusId,
      phone: c.phone,
      website: c.website,
      currencyCode: "USD"
    });
    ctx.refs.customers[c.name] = custId;

    // Interceptor created customerPayment/Shipping/Tax — just update payment term
    await client.query(
      `UPDATE "customerPayment" SET "paymentTermId" = $1 WHERE "customerId" = $2`,
      [netThirty.id, custId]
    );
    await client.query(
      `UPDATE "customerShipping" SET "shippingMethodId" = $1 WHERE "customerId" = $2`,
      [ctx.refs.shippingMethods["UPS Ground"], custId]
    );
  }

  // Customer contacts
  for (const cc of CUSTOMER_CONTACTS) {
    const customerId = ctx.refs.customers[cc.customer];
    const contactId = await insertId(ctx, "contact", {
      firstName: cc.firstName,
      lastName: cc.lastName,
      email: cc.email,
      title: cc.title,
      isCustomer: true
    });
    ctx.refs.contacts[`${cc.customer}:${cc.lastName}`] = contactId;

    const addrId = await insertId(ctx, "address", {
      addressLine1: "See parent",
      city: "Houston",
      stateProvince: "TX",
      postalCode: "77058",
      countryCode: "US"
    });
    const locId = await insertId(ctx, "customerLocation", {
      customerId,
      addressId: addrId,
      name: "Billing"
    });
    ctx.refs.misc[`cloc:${cc.customer}`] = locId;

    await insertId(ctx, "customerContact", {
      customerId,
      contactId,
      customerLocationId: locId
    });
  }

  // ── Suppliers ─────────────────────────────────────────────────────────────
  ctx.log("suppliers");
  for (const s of SUPPLIERS) {
    const typeId = ctx.refs.misc[`stype:${s.type}`];
    const supId = await insertId(ctx, "supplier", {
      name: s.name,
      supplierTypeId: typeId,
      phone: s.phone,
      website: s.website,
      currencyCode: "USD"
    });
    ctx.refs.suppliers[s.name] = supId;

    await client.query(
      `UPDATE "supplierPayment" SET "paymentTermId" = $1 WHERE "supplierId" = $2`,
      [netThirty.id, supId]
    );
    await client.query(
      `UPDATE "supplierShipping" SET "shippingMethodId" = $1 WHERE "supplierId" = $2`,
      [ctx.refs.shippingMethods["UPS Ground"], supId]
    );
  }

  // Supplier contacts + addresses
  for (const sc of SUPPLIER_CONTACTS) {
    const supplierId = ctx.refs.suppliers[sc.supplier];
    const contactId = await insertId(ctx, "contact", {
      firstName: sc.firstName,
      lastName: sc.lastName,
      email: sc.email,
      title: sc.title,
      isCustomer: false
    });
    ctx.refs.contacts[`${sc.supplier}:${sc.lastName}`] = contactId;

    const addrId = await insertId(ctx, "address", {
      addressLine1: "See supplier record",
      city: "Houston",
      stateProvince: "TX",
      postalCode: "77058",
      countryCode: "US"
    });
    const supLocId = await insertId(ctx, "supplierLocation", {
      supplierId,
      addressId: addrId,
      name: "Billing"
    });
    ctx.refs.misc[`sloc:${sc.supplier}`] = supLocId;

    const scId = await insertId(ctx, "supplierContact", {
      supplierId,
      contactId,
      supplierLocationId: supLocId
    });
    ctx.refs.contacts[`sc:${sc.supplier}`] = scId;
  }

  // ── Supplier processes (contract manufacturer) ────────────────────────────
  ctx.log("supplier processes");
  for (const sp of SUPPLIER_PROCESSES) {
    const supplierId = ctx.refs.suppliers[sp.supplier];
    const processId = ctx.refs.processes[sp.process];
    if (supplierId && processId) {
      const spId = await insertId(ctx, "supplierProcess", {
        supplierId,
        processId,
        leadTime: 5
      });
      ctx.refs.misc[`sp:${sp.supplier}:${sp.process}`] = spId;
    }
  }

  // ── Contractors (need a supplierContact as their identity) ─────────────────
  // Contractors are individuals — they reference a supplierContact row for their
  // base identity. We create a "Staffing Agencies" supplier for that purpose.
  ctx.log("contractors");
  const staffAgencyId = await insertId(ctx, "supplier", {
    name: "Orbital Staffing",
    supplierTypeId: ctx.refs.misc["stype:Services"],
    phone: "+1-281-555-1100",
    currencyCode: "USD"
  });
  ctx.refs.suppliers["Orbital Staffing"] = staffAgencyId;

  const contractorDefs = [
    {
      firstName: "Rafael",
      lastName: "Montoya",
      email: "r.montoya@contractor.local",
      ability: "CNC Operation"
    },
    {
      firstName: "Anna",
      lastName: "Kowalski",
      email: "a.kowalski@contractor.local",
      ability: "PCB Rework"
    }
  ];

  for (const cd of contractorDefs) {
    const cContactId = await insertId(ctx, "contact", {
      firstName: cd.firstName,
      lastName: cd.lastName,
      email: cd.email,
      isCustomer: false
    });
    const supContactId = await insertId(ctx, "supplierContact", {
      supplierId: staffAgencyId,
      contactId: cContactId
    });
    // contractor.id = the supplierContact.id
    await insertRow(ctx, "contractor", {
      id: supContactId,
      hoursPerWeek: 40
    });
    await insertRow(ctx, "contractorAbility", {
      contractorId: supContactId,
      abilityId: ctx.refs.abilities[cd.ability]
    });
  }

  // ── Printer routes ─────────────────────────────────────────────────────────
  ctx.log("printer routes");
  await insertRow(ctx, "printerRoute", {
    name: "Main Label Printer",
    locationId: plantId,
    format: "zpl",
    printerUrl: "http://192.168.1.50:9100",
    companyId
  });

  // ── Procedures (shop-floor work instructions) ─────────────────────────────
  // Two versions of the same name: the version menu groups on `name`, so V1
  // Archived + V2 Active is what gives a procedure a readable history.
  ctx.log("procedures");
  for (const spec of PROCEDURES) {
    const processId = ctx.refs.processes[spec.process];
    if (!processId) continue;
    for (const version of spec.versions) {
      const procedureId = await insertId(ctx, "procedure", {
        name: spec.name,
        processId,
        version: version.version,
        status: version.status,
        content: RICH(spec.description)
      });
      if (version.status === "Active") {
        ctx.refs.misc[`procedure:${spec.name}`] = procedureId;
      }
      for (const [index, step] of version.steps.entries()) {
        await insertId(ctx, "procedureStep", {
          procedureId,
          name: step.name,
          type: step.type,
          sortOrder: index + 1,
          required: step.required ?? true,
          unitOfMeasureCode: step.unitOfMeasureCode ?? null,
          minValue: step.minValue ?? null,
          maxValue: step.maxValue ?? null,
          description: RICH(step.instruction)
        });
      }
    }
  }

  // ── Cost centers ───────────────────────────────────────────────────────────
  ctx.log("cost centers");
  for (const name of [
    "Direct Labor",
    "Manufacturing Overhead",
    "Engineering",
    "G&A"
  ]) {
    ctx.refs.misc[`cc:${name}`] = await insertId(ctx, "costCenter", { name });
  }

  // ── No-quote reasons ──────────────────────────────────────────────────────
  ctx.log("no-quote reasons");
  for (const name of [
    "Out of Scope",
    "Capacity Constraint",
    "No Margin",
    "Strategic Hold"
  ]) {
    await insertId(ctx, "noQuoteReason", { name });
  }
}
