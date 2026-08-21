import type {
  ContractorAgencySpec,
  FoundationData,
  PlantSpec,
  PrinterRouteSpec,
  ProcedureSpec,
  ProcedureStepSpec,
  ShelfSpec,
  ShiftSpec,
  WarehouseSpec
} from "../../types.ts";

// ---------------------------------------------------------------------------
// Satellites / spacecraft theme — Orbital Systems Inc.
// ---------------------------------------------------------------------------

export const DEPT_NAMES = [
  "Engineering",
  "Manufacturing",
  "Quality",
  "Supply Chain"
];
export const ABILITIES = [
  "CNC Operation",
  "Welding",
  "Clean Room Assembly",
  "PCB Rework",
  "Inspection",
  "Composite Layup"
];
export const PROCESSES = [
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

export const WORK_CENTERS = [
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

// Link work centers to processes. Most cells run several — the clean room in
// particular is where layup, assembly and potting all have to happen.
export const WORK_CENTER_PROCESS_LINKS: Array<[string, string]> = [
  ["CNC Mill", "Machining"],
  ["CNC Mill", "Composite Layup"],
  ["TIG Welder Cell", "Welding"],
  ["TIG Welder Cell", "Machining"],
  ["Clean Room Bay A", "Clean Room Assembly"],
  ["Clean Room Bay A", "Composite Layup"],
  ["Clean Room Bay A", "Potting & Conformal Coat"],
  ["PCB Lab", "PCB Assembly"],
  ["PCB Lab", "Potting & Conformal Coat"],
  ["TVAC Chamber 1", "Thermal Vacuum Test"],
  ["TVAC Chamber 1", "Final Inspection"],
  ["QC Bench", "Final Inspection"],
  ["QC Bench", "Thermal Vacuum Test"],
  ["Potting Station", "Potting & Conformal Coat"],
  ["Potting Station", "Clean Room Assembly"]
];

export const PLANT: PlantSpec = {
  name: "Manufacturing Plant",
  addressLine1: "4500 Space Commerce Drive",
  city: "Houston",
  stateProvince: "TX",
  postalCode: "77058",
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

export const STORAGE_TYPES = ["Shelf", "Bin", "Rack"];

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
  { name: "CleanRoom", warehouse: "Main", storageType: "Shelf" }
];

export const PRINTER_ROUTE: PrinterRouteSpec = {
  name: "Main Label Printer",
  format: "zpl",
  printerUrl: "http://192.168.1.50:9100"
};

// Contractors are individuals who reference a supplierContact for their
// identity, so they need an agency supplier to hang off.
export const CONTRACTOR_AGENCY: ContractorAgencySpec = {
  name: "Orbital Staffing",
  type: "Services",
  phone: "+1-281-555-1100"
};

export const CUSTOMER_TYPES = [
  "Government",
  "Commercial",
  "Research",
  "Internal"
];

export const SUPPLIER_TYPES = [
  "Electronics",
  "Hardware",
  "Materials",
  "Propulsion",
  "Contract Manufacturer",
  "Services"
];

export const CUSTOMERS = [
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

export const CUSTOMER_CONTACTS = [
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

export const SUPPLIERS = [
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

export const SUPPLIER_CONTACTS = [
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
export const SUPPLIER_PROCESSES = [
  { supplier: "AstroMill Machining", process: "Machining" },
  { supplier: "AstroMill Machining", process: "Welding" },
  // Backs the outside-processing (anodize) step on the structural frame.
  { supplier: "AstroMill Machining", process: "Outside Processing" }
];

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
    ability: "PCB Rework"
  }
];

export const STRUCTURAL_STEPS_V2: ProcedureStepSpec[] = [
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

export const PROCEDURES: ProcedureSpec[] = [
  {
    name: "Structural Frame Assembly",
    process: "Clean Room Assembly",
    description:
      "Assembly and torque procedure for the ESPA-class structural frame.",
    versions: [
      {
        version: 1,
        status: "Draft",
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
      { version: 2, status: "Draft", steps: STRUCTURAL_STEPS_V2 }
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
        status: "Draft",
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
        status: "Draft",
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

export const satelliteFoundation: FoundationData = {
  departments: DEPT_NAMES,
  abilities: ABILITIES,
  processes: PROCESSES,
  workCenters: WORK_CENTERS,
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
  plant: PLANT,
  shifts: SHIFTS,
  warehouses: WAREHOUSES,
  storageTypes: STORAGE_TYPES,
  shelves: SHELVES,
  printerRoute: PRINTER_ROUTE,
  defaultShippingMethod: "UPS Ground",
  contractorAgency: CONTRACTOR_AGENCY,
  partyAddressCity: "Houston",
  partyAddressStateProvince: "TX",
  partyAddressPostalCode: "77058",
  partyAddressCountryCode: "US"
};
