// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  ContractorAgencySpec,
  EmployeeJobSpec,
  FoundationData,
  HolidaySpec,
  MaterialTaxonomySpec,
  PartnerSpec,
  PlantSpec,
  PrinterRouteSpec,
  ProcedureSpec,
  ProcedureStepSpec,
  ShelfSpec,
  ShiftSpec,
  TagSpec,
  WarehouseSpec,
  WorkCenterSpec
} from "../../types.ts";

// ---------------------------------------------------------------------------
// Defense sUAS theme — Halberd Unmanned Systems (ISR-4 Tactical Quadcopter)
// ---------------------------------------------------------------------------

export const DEPT_NAMES = [
  "Engineering",
  "Manufacturing",
  "Quality",
  "Supply Chain"
];
export const ABILITIES = [
  "CNC Operation",
  "Adhesive Bonding",
  "UAS Integration",
  "IPC J-STD-001 Soldering",
  "Inspection",
  "Composite Layup"
];
export const PROCESSES = [
  { name: "Machining", factor: "Minutes/Piece", type: "Process" },
  { name: "Adhesive Bonding", factor: "Minutes/Piece", type: "Process" },
  { name: "UAS Integration", factor: "Hours/Piece", type: "Assembly" },
  { name: "PCB Assembly", factor: "Minutes/Piece", type: "Process" },
  { name: "Composite Layup", factor: "Hours/Piece", type: "Process" },
  {
    name: "MIL-STD-810H Environmental Test",
    factor: "Total Hours",
    type: "Inspection"
  },
  {
    name: "Potting & Conformal Coat",
    factor: "Minutes/Piece",
    type: "Process"
  },
  { name: "Final Inspection", factor: "Hours/Piece", type: "Inspection" },
  { name: "Outside Processing", factor: "Total Hours", type: "Process" }
];

export const WORK_CENTERS = [
  {
    name: "CNC Mill",
    dept: "Manufacturing",
    ability: "CNC Operation",
    laborRate: 85,
    machineRate: 120
  },
  {
    name: "Bonding & Cure Cell",
    dept: "Manufacturing",
    ability: "Adhesive Bonding",
    laborRate: 75,
    machineRate: 30
  },
  {
    name: "Integration Bay A",
    dept: "Manufacturing",
    ability: "UAS Integration",
    laborRate: 95,
    machineRate: 0
  },
  {
    name: "Avionics Lab",
    dept: "Manufacturing",
    ability: "IPC J-STD-001 Soldering",
    laborRate: 90,
    machineRate: 45
  },
  {
    name: "Environmental Chamber 1",
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
    ability: "UAS Integration",
    laborRate: 65,
    machineRate: 20
  }
];

// Link work centers to processes. Most cells run several — the integration bay
// in particular is where layup, assembly and potting all have to happen.
export const WORK_CENTER_PROCESS_LINKS: Array<[string, string]> = [
  ["CNC Mill", "Machining"],
  ["CNC Mill", "Composite Layup"],
  ["Bonding & Cure Cell", "Adhesive Bonding"],
  ["Bonding & Cure Cell", "Machining"],
  ["Integration Bay A", "UAS Integration"],
  ["Integration Bay A", "Composite Layup"],
  ["Integration Bay A", "Potting & Conformal Coat"],
  ["Avionics Lab", "PCB Assembly"],
  ["Avionics Lab", "Potting & Conformal Coat"],
  ["Environmental Chamber 1", "MIL-STD-810H Environmental Test"],
  ["Environmental Chamber 1", "Final Inspection"],
  ["QC Bench", "Final Inspection"],
  ["QC Bench", "MIL-STD-810H Environmental Test"],
  ["Potting Station", "Potting & Conformal Coat"],
  ["Potting Station", "UAS Integration"]
];

export const WORK_CENTER_SHIFTS: Array<[string, string]> = [
  ["CNC Mill", "Day Shift"],
  ["Bonding & Cure Cell", "Day Shift"],
  ["Integration Bay A", "Day Shift"],
  ["Integration Bay A", "Swing Shift"],
  ["Avionics Lab", "Day Shift"],
  ["Environmental Chamber 1", "Day Shift"],
  ["Environmental Chamber 1", "Swing Shift"],
  ["QC Bench", "Day Shift"],
  ["Potting Station", "Day Shift"]
];

export const EMPLOYEE_JOB: EmployeeJobSpec = {
  title: "Production Supervisor",
  department: "Manufacturing",
  shift: "Day Shift",
  startDateOffset: -1140
};

export const PLANT: PlantSpec = {
  name: "Manufacturing Plant",
  addressLine1: "2750 Discovery Ridge Drive NW",
  city: "Huntsville",
  stateProvince: "AL",
  postalCode: "35806",
  countryCode: "US",
  timezone: "America/Chicago"
};

export const SHIFTS: ShiftSpec[] = [
  {
    name: "Day Shift",
    startTime: "06:00:00",
    endTime: "14:30:00",
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true
  },
  {
    name: "Swing Shift",
    startTime: "14:30:00",
    endTime: "23:00:00",
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true
  }
];

export const WAREHOUSES: WarehouseSpec[] = [
  {
    key: "Main",
    name: "Main Warehouse",
    requiresPick: true,
    requiresPutAway: true,
    requiresBin: true
  },
  { key: "RMA", name: "RMA / Return" },
  { key: "QC", name: "QC Hold", requiresBin: true }
];

export const STORAGE_TYPES = ["Shelf", "Bin", "Rack", "Quarantine"];

// Names here are the contract for OPENING_STOCK[].shelf — a mismatch is a hard
// error, so the racking rows are listed rather than generated.
export const SHELVES: ShelfSpec[] = [
  { name: "Aisle-A", warehouse: "Main", storageType: "Rack" },
  { name: "A1-L1", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A1-L2", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A1-L3", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A2-L1", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A2-L2", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A2-L3", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A3-L1", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A3-L2", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "A3-L3", warehouse: "Main", storageType: "Bin", parent: "Aisle-A" },
  { name: "ESD-Cage", warehouse: "Main", storageType: "Shelf" },
  // Non-nettable (its storage type is): stock held here pending a quality
  // decision is not planned against or picked.
  { name: "MRB-Hold", warehouse: "Main", storageType: "Quarantine" }
];

export const PRINTER_ROUTE: PrinterRouteSpec = {
  name: "Main Label Printer",
  format: "zpl",
  printerUrl: "http://192.168.1.50:9100"
};

// Contractors are individuals who reference a supplierContact for their
// identity, so they need an agency supplier to hang off.
export const CONTRACTOR_AGENCY: ContractorAgencySpec = {
  name: "Tennessee Valley Technical Staffing",
  type: "Services",
  phone: "+1-256-555-1100"
};

export const CUSTOMER_TYPES = [
  "DoD Program Office",
  "Prime Contractor",
  "Special Operations",
  "Foreign Government",
  "Public Safety",
  "Internal"
];

export const SUPPLIER_TYPES = [
  "Electronics",
  "Hardware",
  "Materials",
  "UAS Components",
  "Contract Manufacturer",
  "Services"
];

export const CUSTOMERS = [
  {
    name: "Army Small UAS Program Office",
    type: "DoD Program Office",
    status: "Active",
    phone: "+1-256-555-0100",
    website: "https://army-suas-po.example.gov"
  },
  {
    name: "Northgate Defense Systems",
    type: "Prime Contractor",
    status: "Active",
    phone: "+1-703-555-0200",
    website: "https://northgate-defense.example.com"
  },
  {
    name: "Special Operations Aviation Command",
    type: "Special Operations",
    status: "Active",
    phone: "+1-813-555-0300",
    website: "https://soac-aviation.example.gov"
  },
  {
    name: "State Emergency Response Agency",
    type: "Public Safety",
    status: "Lead",
    phone: "+1-334-555-0400",
    website: "https://sera.example.gov"
  },
  {
    name: "Defense Innovation Pilot Office",
    type: "DoD Program Office",
    status: "Active",
    phone: "+1-650-555-0500",
    website: "https://dipo.example.gov"
  },
  // The one foreign buyer. Its own address (Norway) is what lets the
  // "ITAR UAS — US ship-to only" sales rule fire on its Draft order.
  {
    name: "Nordic Defence Materiel Agency",
    type: "Foreign Government",
    status: "Active",
    phone: "+47-23-55-0600",
    website: "https://ndma.example.no",
    address: {
      addressLine1: "Kongsgata 14",
      city: "Oslo",
      stateProvince: "Oslo",
      postalCode: "0153",
      countryCode: "NO"
    }
  }
];

export const CUSTOMER_CONTACTS = [
  {
    customer: "Army Small UAS Program Office",
    firstName: "Marcus",
    lastName: "Reyes",
    email: "m.reyes@army-suas-po.example.gov",
    title: "Contracting Officer"
  },
  {
    customer: "Northgate Defense Systems",
    firstName: "Priya",
    lastName: "Shah",
    email: "pshah@northgate-defense.example.com",
    title: "Subcontracts Manager"
  },
  {
    customer: "Special Operations Aviation Command",
    firstName: "James",
    lastName: "Okonkwo",
    email: "j.okonkwo@soac-aviation.example.gov",
    title: "Program Manager"
  },
  {
    customer: "State Emergency Response Agency",
    firstName: "Sofia",
    lastName: "Lindqvist",
    email: "s.lindqvist@sera.example.gov",
    title: "Aviation Unit Chief"
  },
  {
    customer: "Defense Innovation Pilot Office",
    firstName: "Dana",
    lastName: "Whitaker",
    email: "d.whitaker@dipo.example.gov",
    title: "Agreements Officer"
  },
  {
    customer: "Nordic Defence Materiel Agency",
    firstName: "Erik",
    lastName: "Haugland",
    email: "erik.haugland@ndma.example.no",
    title: "Procurement Officer"
  }
];

export const SUPPLIERS = [
  // Authorized distributor: bare boards, battery packs, mesh radios. Buying
  // through an authorized channel is the counterfeit-prevention control.
  {
    name: "Vanguard Electronics Supply",
    type: "Electronics",
    phone: "+1-408-555-0500",
    website: "https://vanguard-elec.example.com"
  },
  {
    name: "MilSpec Fastener Supply",
    type: "Hardware",
    phone: "+1-206-555-0600",
    website: "https://milspec-fasteners.example.com"
  },
  {
    name: "Ridgeline Composites",
    type: "Materials",
    phone: "+1-714-555-0700",
    website: "https://ridgeline-composites.example.com"
  },
  // NDAA-compliant motors, propellers and folding arms.
  {
    name: "Sentry Propulsion Systems",
    type: "UAS Components",
    phone: "+1-801-555-0800",
    website: "https://sentry-propulsion.example.com"
  },
  // Motor controllers and EO/IR gimbals.
  {
    name: "Meshline Tactical Systems",
    type: "Electronics",
    phone: "+1-303-555-0900",
    website: "https://meshline-tactical.example.com"
  },
  {
    name: "Redstone Precision Machining",
    type: "Contract Manufacturer",
    phone: "+1-256-555-1000",
    website: "https://redstone-precision.example.com"
  },
  // Status showcases + the EUR vendor. None of these may be referenced by
  // purchasing data — they exist so every supplier status renders somewhere.
  {
    name: "Legacy Harness Co",
    type: "Hardware",
    phone: "+1-720-555-1200",
    website: "https://legacyharness.example.com",
    status: "Inactive" as const
  },
  // A second motor source, under qualification (first article + NDAA audit).
  {
    name: "Ironclad Motor Co",
    type: "UAS Components",
    phone: "+1-425-555-1300",
    website: "https://ironclad-motor.example.com",
    status: "Pending" as const
  },
  // Rejected: its supplier audit traced motor magnets to a covered country.
  {
    name: "LowBid UAV Components",
    type: "Electronics",
    phone: "+1-702-555-1400",
    website: "https://lowbid-uav.example.com",
    status: "Rejected" as const
  },
  {
    name: "Rheinland Precision Bearings GmbH",
    type: "Hardware",
    phone: "+49-711-555-1500",
    website: "https://rheinland-bearings.example.de",
    status: "Active" as const,
    currencyCode: "EUR",
    address: {
      addressLine1: "Industriestraße 42",
      city: "Stuttgart",
      stateProvince: "Baden-Württemberg",
      postalCode: "70565",
      countryCode: "DE"
    }
  }
];

export const SUPPLIER_CONTACTS = [
  {
    supplier: "Vanguard Electronics Supply",
    firstName: "Wei",
    lastName: "Chen",
    email: "w.chen@vanguard-elec.example.com",
    title: "Account Manager"
  },
  {
    supplier: "MilSpec Fastener Supply",
    firstName: "Lena",
    lastName: "Hofer",
    email: "lhofer@milspec-fasteners.example.com",
    title: "Sales Rep"
  },
  {
    supplier: "Ridgeline Composites",
    firstName: "Carlos",
    lastName: "Mendez",
    email: "cmendez@ridgeline-composites.example.com",
    title: "Technical Sales"
  },
  {
    supplier: "Sentry Propulsion Systems",
    firstName: "Yuki",
    lastName: "Tanaka",
    email: "ytanaka@sentry-propulsion.example.com",
    title: "Program Manager"
  },
  {
    supplier: "Meshline Tactical Systems",
    firstName: "Amara",
    lastName: "Osei",
    email: "aosei@meshline-tactical.example.com",
    title: "Sales Director"
  },
  {
    supplier: "Redstone Precision Machining",
    firstName: "Deron",
    lastName: "Brooks",
    email: "dbrooks@redstone-precision.example.com",
    title: "Account Rep"
  },
  {
    supplier: "Legacy Harness Co",
    firstName: "Pat",
    lastName: "Whitfield",
    email: "pwhitfield@legacyharness.example.com",
    title: "Sales Manager"
  },
  {
    supplier: "Ironclad Motor Co",
    firstName: "Naomi",
    lastName: "Fedorova",
    email: "nfedorova@ironclad-motor.example.com",
    title: "Business Development"
  },
  {
    supplier: "LowBid UAV Components",
    firstName: "Gary",
    lastName: "Duncan",
    email: "gduncan@lowbid-uav.example.com",
    title: "Account Executive"
  },
  {
    supplier: "Rheinland Precision Bearings GmbH",
    firstName: "Katrin",
    lastName: "Vogel",
    email: "k.vogel@rheinland-bearings.example.de",
    title: "Export Sales"
  }
];

// Supplier processes for the contract manufacturer
export const SUPPLIER_PROCESSES = [
  { supplier: "Redstone Precision Machining", process: "Machining" },
  { supplier: "Redstone Precision Machining", process: "Adhesive Bonding" },
  // Backs the outside-processing (anodize) step on the structural frame.
  { supplier: "Redstone Precision Machining", process: "Outside Processing" }
];

export const PARTNERS: PartnerSpec[] = [
  {
    supplier: "Redstone Precision Machining",
    ability: "CNC Operation",
    hoursPerWeek: 40
  },
  {
    supplier: "Redstone Precision Machining",
    ability: "Adhesive Bonding",
    hoursPerWeek: 16
  },
  {
    supplier: "Ridgeline Composites",
    ability: "Composite Layup",
    hoursPerWeek: 24
  }
];

export const HQ_WORK_CENTER: WorkCenterSpec = {
  name: "Hover Test Cage",
  dept: "Engineering",
  ability: "Inspection",
  laborRate: 80,
  machineRate: 25
};

export const CONTRACTORS = [
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
    ability: "IPC J-STD-001 Soldering"
  }
];

export const STRUCTURAL_STEPS_V2: ProcedureStepSpec[] = [
  {
    name: "Verify airframe kit against the pick list",
    type: "Checkbox",
    instruction:
      "Confirm the frame plate, four hinge blocks, four motor mounts and the fastener kit are present and match the drawing revision on the traveler."
  },
  {
    name: "Torque hinge block fasteners",
    type: "Measurement",
    instruction:
      "Torque the M5 A286 hinge-block fasteners in a cross pattern. Record the final torque driver reading.",
    unitOfMeasureCode: "EA",
    minValue: 4,
    maxValue: 5
  },
  {
    name: "Measure motor-mount coplanarity",
    type: "Measurement",
    instruction:
      "Set the frame on the surface plate and measure the four motor-mount faces with the height gauge. The spread must stay inside 0.5 mm.",
    unitOfMeasureCode: "EA",
    minValue: 0,
    maxValue: 0.5
  },
  {
    name: "Record assembler",
    type: "Person",
    instruction: "Sign off as the assembler responsible for this airframe."
  },
  {
    name: "Bag and label for integration transfer",
    type: "Task",
    instruction:
      "Bag the airframe in ESD-safe film, apply the job label with the airframe serial, and stage it on the integration bay cart.",
    required: false
  }
];

export const PROCEDURES: ProcedureSpec[] = [
  {
    name: "Airframe Assembly",
    process: "UAS Integration",
    description:
      "Assembly and torque procedure for the ISR-4 airframe and frame plate.",
    parameters: [
      { key: "Hinge block fastener torque", value: "4.5 N·m (M5 A286)" },
      { key: "Motor-mount coplanarity limit", value: "0.5 mm" },
      { key: "Thread locker", value: "Medium strength on all hinge fasteners" }
    ],
    versions: [
      {
        version: 1,
        status: "Archived",
        steps: [
          {
            name: "Verify airframe kit against the pick list",
            type: "Checkbox",
            instruction: "Confirm all machined airframe parts are present."
          },
          {
            name: "Torque hinge block fasteners",
            type: "Measurement",
            instruction:
              "Torque the M5 hinge-block fasteners in a cross pattern to 4.5 N·m.",
            unitOfMeasureCode: "EA",
            minValue: 4.2,
            maxValue: 4.8
          }
        ]
      },
      { version: 2, status: "Active", steps: STRUCTURAL_STEPS_V2 }
    ]
  },
  {
    name: "Air Vehicle Integration",
    process: "UAS Integration",
    description:
      "Integration of the airframe, arm set, avionics bay, power system and comms into a serialized ISR4-AV.",
    versions: [
      {
        version: 1,
        status: "Active",
        steps: [
          {
            name: "Stage sub-assemblies at the integration bay",
            type: "Checkbox",
            instruction:
              "Move the airframe, arm set, avionics bay, power system and comms assembly into Integration Bay A. Confirm each serial against the traveler."
          },
          {
            name: "Mate the avionics bay to the frame plate",
            type: "Task",
            instruction:
              "Seat the avionics bay on its isolators, engage the captive fasteners and confirm the ground strap is bonded."
          },
          {
            name: "Route and dress the harness",
            type: "Checkbox",
            instruction:
              "Route HRN-100 through the frame raceways, tie at every clamp and confirm no connector is under strain."
          },
          {
            name: "Measure take-off weight",
            type: "Measurement",
            instruction:
              "Weigh the air vehicle with both battery packs and the gimbal fitted. Record the mass in pounds.",
            unitOfMeasureCode: "LB",
            minValue: 30,
            maxValue: 34
          },
          {
            name: "Record integration lead",
            type: "Person",
            instruction:
              "Sign off as the integration lead responsible for this air vehicle."
          }
        ]
      }
    ]
  },
  {
    name: "Environmental Stress Screening",
    process: "MIL-STD-810H Environmental Test",
    description:
      "Temperature and vibration screen for an integrated air vehicle (MIL-STD-810H tailored).",
    parameters: [
      { key: "Temperature cycles", value: "6" },
      { key: "Temperature range", value: "-32 °C to +55 °C" },
      {
        key: "Random vibration",
        value: "Method 514.8, Category 24, 10 min/axis"
      }
    ],
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Fit the vibration fixture and accelerometers",
            type: "Task",
            instruction:
              "Bolt the air vehicle to the vibration fixture and bond the control accelerometer next to the frame plate."
          },
          {
            name: "Record the chamber soak temperature",
            type: "Measurement",
            instruction:
              "Soak at the cold extreme and record the chamber air temperature once it stabilises.",
            unitOfMeasureCode: "EA",
            minValue: -34,
            maxValue: -30
          },
          {
            name: "Run six temperature cycles",
            type: "Checkbox",
            instruction:
              "Cycle between -32 °C and +55 °C, dwelling one hour at each extreme. Tick once all six cycles complete."
          },
          {
            name: "Functional check at hot soak",
            type: "Checkbox",
            instruction:
              "Power the air vehicle on the bench supply during the final hot dwell. Confirm the flight controller, datalink and gimbal report no faults."
          },
          {
            name: "Stamp chamber door-open time",
            type: "Timestamp",
            instruction:
              "Record the moment the chamber returns to ambient. The 2-hour stabilisation clock before the hover test starts here."
          },
          {
            name: "Attach the test profile export",
            type: "File",
            instruction:
              "Export the temperature and vibration profile from the test controller and attach it to the test record.",
            fileTypes: ["csv", "pdf"]
          },
          {
            name: "Post-test workmanship inspection",
            type: "Inspection",
            instruction:
              "Inspect connector locking, harness clamps and arm hinge play for damage from cycling. Photograph any finding.",
            required: false
          }
        ]
      }
    ]
  },
  {
    name: "First Article Inspection (AS9102)",
    process: "Final Inspection",
    description:
      "AS9102 first article inspection for a new or changed part number. The report goes to the customer with the first delivery.",
    parameters: [
      { key: "Report format", value: "AS9102 Forms 1, 2 and 3" },
      {
        key: "Trigger",
        value: "New part, new revision, new source or 2-year production gap"
      }
    ],
    versions: [
      {
        version: 1,
        status: "Active",
        steps: [
          {
            name: "Balloon the drawing",
            type: "Checkbox",
            instruction:
              "Number every characteristic on the released drawing. Each balloon becomes one row on Form 3."
          },
          {
            name: "Collect material and special-process certs",
            type: "Checkbox",
            instruction:
              "Attach the mill certs, anodize cert and supplier certificates of conformance for Form 2."
          },
          {
            name: "Measure every ballooned characteristic",
            type: "File",
            instruction:
              "Measure each characteristic and attach the completed Form 3 measurement sheet.",
            fileTypes: ["pdf", "xlsx"]
          },
          {
            name: "Quality approval",
            type: "Person",
            instruction:
              "Sign off as the quality engineer who approves the first article."
          }
        ]
      }
    ]
  },
  {
    name: "ITAR Technical Data Handling",
    process: "UAS Integration",
    description:
      "Controls for ITAR technical data and defense articles on the shop floor (22 CFR 120–130).",
    parameters: [
      {
        key: "Access",
        value: "U.S. persons only — badge check at Integration Bay A"
      },
      {
        key: "Marking",
        value: "ITAR warning statement on every traveler and drawing"
      }
    ],
    versions: [
      {
        version: 1,
        status: "Active",
        steps: [
          {
            name: "Confirm U.S. person status",
            type: "Checkbox",
            instruction:
              "Confirm every person at the bench is on the U.S. person access list before the traveler is opened."
          },
          {
            name: "Check the export marking",
            type: "Checkbox",
            instruction:
              "Confirm the traveler and drawings carry the ITAR warning statement."
          },
          {
            name: "Record the data custodian",
            type: "Person",
            instruction:
              "Sign off as the custodian of the technical data package."
          }
        ]
      }
    ]
  }
];

export const SHIPPING_METHODS = [
  "UPS Ground",
  "UPS 2nd Day Air",
  "FedEx Priority Overnight",
  "Will Call",
  "Freight"
];
export const SHIPPING_TERMS = [
  "FOB Origin",
  "FOB Destination",
  "Net 30 EOM",
  "Prepaid & Add"
];

export const ITEM_POSTING_GROUPS = [
  "Raw Material",
  "Finished Goods",
  "WIP",
  "Supplies",
  "Service Items"
];

export const COST_CENTERS = [
  "Direct Labor",
  "Manufacturing Overhead",
  "Engineering",
  "G&A"
];

export const NO_QUOTE_REASONS = [
  "Out of Scope",
  "Capacity Constraint",
  "No Margin",
  "Strategic Hold"
];

// Offsets are positive (upcoming) and distinct — holiday has UNIQUE (date).
export const HOLIDAYS: HolidaySpec[] = [
  { name: "Company Founding Day", dateOffset: 40 },
  { name: "Veterans Day (observed)", dateOffset: 100 },
  { name: "Year-End Shutdown", dateOffset: 160 }
];

export const TAGS: TagSpec[] = [
  { name: "Flight Critical", table: "operation" },
  { name: "ITAR Controlled", table: "procedure" },
  { name: "ESD Certified", table: "training" },
  { name: "Shelf-Life Controlled", table: "material" },
  { name: "Calibrated", table: "tool" }
];

// Names deliberately avoid the GLOBAL substances/forms migrations seed (Steel,
// Aluminum, Sheet, Plate, …) so the settings screens don't show duplicates.
export const MATERIAL_TAXONOMY: MaterialTaxonomySpec = {
  substances: [
    { name: "Carbon Fiber Composite", code: "CFRP" },
    // Backs the Kapton tape classification on MAT-KAPTON (items.ts).
    { name: "Polyimide Film", code: "PI" }
  ],
  forms: [
    { name: "Prepreg Roll", code: "PPROLL" },
    { name: "Film Roll", code: "FILMROLL" }
  ],
  types: [
    {
      name: "CFRP Prepreg Roll",
      code: "CFRP-PP",
      substance: "Carbon Fiber Composite",
      form: "Prepreg Roll"
    },
    {
      name: "Polyimide Tape Roll",
      code: "PI-ROLL",
      substance: "Polyimide Film",
      form: "Film Roll"
    }
  ],
  grades: [
    { name: "T700", substance: "Carbon Fiber Composite" },
    { name: "T300", substance: "Carbon Fiber Composite" },
    { name: "Kapton HN", substance: "Polyimide Film" }
  ],
  finishes: [
    { name: "Epoxy Resin System", substance: "Carbon Fiber Composite" },
    { name: "Silicone Adhesive Backing", substance: "Polyimide Film" }
  ],
  dimensions: [
    { name: "300mm x 50m", form: "Prepreg Roll", isMetric: true },
    { name: "600mm x 25m", form: "Prepreg Roll", isMetric: true },
    { name: "25mm x 33m", form: "Film Roll", isMetric: true }
  ]
};

export const defenseFoundation: FoundationData = {
  departments: DEPT_NAMES,
  abilities: ABILITIES,
  processes: PROCESSES,
  workCenters: WORK_CENTERS,
  hqWorkCenter: HQ_WORK_CENTER,
  customers: CUSTOMERS,
  customerContacts: CUSTOMER_CONTACTS,
  suppliers: SUPPLIERS,
  supplierContacts: SUPPLIER_CONTACTS,
  supplierProcesses: SUPPLIER_PROCESSES,
  procedures: PROCEDURES,
  shippingMethods: SHIPPING_METHODS,
  shippingTerms: SHIPPING_TERMS,
  itemPostingGroups: ITEM_POSTING_GROUPS,
  workCenterProcessLinks: WORK_CENTER_PROCESS_LINKS,
  customerTypes: CUSTOMER_TYPES,
  supplierTypes: SUPPLIER_TYPES,
  costCenters: COST_CENTERS,
  noQuoteReasons: NO_QUOTE_REASONS,
  contractors: CONTRACTORS,
  partners: PARTNERS,
  plant: PLANT,
  shifts: SHIFTS,
  workCenterShifts: WORK_CENTER_SHIFTS,
  employeeJob: EMPLOYEE_JOB,
  warehouses: WAREHOUSES,
  storageTypes: STORAGE_TYPES,
  nonNettableStorageTypes: ["Quarantine"],
  shelves: SHELVES,
  printerRoute: PRINTER_ROUTE,
  holidays: HOLIDAYS,
  tags: TAGS,
  materialTaxonomy: MATERIAL_TAXONOMY,
  defaultShippingMethod: "UPS Ground",
  contractorAgency: CONTRACTOR_AGENCY,
  partyAddressCity: "Huntsville",
  partyAddressStateProvince: "AL",
  partyAddressPostalCode: "35806",
  partyAddressCountryCode: "US"
};
