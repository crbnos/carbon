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
// Contract machine shop theme — Meridian Precision Works.
// ---------------------------------------------------------------------------

export const DEPT_NAMES = [
  "Engineering",
  "Machining",
  "Fabrication",
  "Finishing",
  "Quality"
];

export const ABILITIES = [
  "CNC Milling",
  "CNC Turning",
  "Wire EDM",
  "Sheet Metal Fabrication",
  "Welding",
  "Deburr & Finishing",
  "Inspection"
];

export const PROCESSES = [
  { name: "CNC Milling", factor: "Minutes/Piece", type: "Process" },
  { name: "CNC Turning", factor: "Minutes/Piece", type: "Process" },
  { name: "Wire EDM", factor: "Minutes/Piece", type: "Process" },
  {
    name: "Sheet Metal Fabrication",
    factor: "Minutes/Piece",
    type: "Process"
  },
  { name: "Welding", factor: "Hours/Piece", type: "Process" },
  { name: "Deburr & Finish", factor: "Minutes/Piece", type: "Process" },
  { name: "Mechanical Assembly", factor: "Hours/Piece", type: "Assembly" },
  // A job shop sends work out mid-routing — anodize, heat treat, passivation —
  // so outside processing is a routing step here, not an afterthought.
  { name: "Outside Processing", factor: "Total Hours", type: "Process" },
  { name: "Final Inspection", factor: "Hours/Piece", type: "Inspection" }
];

export const WORK_CENTERS = [
  {
    name: "VMC Cell 1",
    dept: "Machining",
    ability: "CNC Milling",
    laborRate: 72,
    machineRate: 95
  },
  {
    name: "VMC Cell 2",
    dept: "Machining",
    ability: "CNC Milling",
    laborRate: 72,
    machineRate: 95
  },
  {
    name: "Turning Cell",
    dept: "Machining",
    ability: "CNC Turning",
    laborRate: 70,
    machineRate: 88
  },
  {
    name: "Wire EDM Cell",
    dept: "Machining",
    ability: "Wire EDM",
    laborRate: 68,
    machineRate: 82
  },
  {
    name: "Fab & Weld Bay",
    dept: "Fabrication",
    ability: "Welding",
    laborRate: 76,
    machineRate: 45
  },
  {
    name: "Finish & Assembly Bench",
    dept: "Finishing",
    ability: "Deburr & Finishing",
    laborRate: 58,
    machineRate: 0
  },
  {
    name: "CMM Lab",
    dept: "Quality",
    ability: "Inspection",
    laborRate: 74,
    machineRate: 30
  }
];

// A small shop runs more than one process through the same bench, so a work
// center can appear more than once here.
export const WORK_CENTER_PROCESS_LINKS: Array<[string, string]> = [
  ["VMC Cell 1", "CNC Milling"],
  ["VMC Cell 1", "Deburr & Finish"],
  ["VMC Cell 2", "CNC Milling"],
  ["VMC Cell 2", "Deburr & Finish"],
  ["Turning Cell", "CNC Turning"],
  ["Turning Cell", "CNC Milling"],
  ["Wire EDM Cell", "Wire EDM"],
  ["Wire EDM Cell", "Deburr & Finish"],
  ["Fab & Weld Bay", "Sheet Metal Fabrication"],
  ["Fab & Weld Bay", "Welding"],
  ["Fab & Weld Bay", "Deburr & Finish"],
  ["Finish & Assembly Bench", "Deburr & Finish"],
  ["Finish & Assembly Bench", "Mechanical Assembly"],
  ["CMM Lab", "Final Inspection"]
];

export const PLANT: PlantSpec = {
  name: "Meridian Machining Plant",
  addressLine1: "1725 Kishwaukee Street",
  city: "Rockford",
  stateProvince: "IL",
  postalCode: "61104",
  countryCode: "US",
  timezone: "America/Chicago"
};

// Two production shifts plus Saturday overtime — how a job shop absorbs the
// short-lead-time work it wins.
export const SHIFTS: ShiftSpec[] = [
  {
    name: "First Shift",
    startTime: "05:00:00",
    endTime: "13:30:00",
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true
  },
  {
    name: "Second Shift",
    startTime: "13:30:00",
    endTime: "22:00:00",
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true
  },
  {
    name: "Saturday Overtime",
    startTime: "06:00:00",
    endTime: "14:00:00",
    saturday: true
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
  // Parts physically leave the building for anodize or heat treat — they are
  // still the shop's inventory while they are out.
  { key: "OSP", name: "Outside Processing" },
  { key: "QC", name: "Incoming Inspection Hold", requiresBin: true }
];

export const STORAGE_TYPES = ["Shelf", "Bin", "Rack"];

// Names here are the contract for OPENING_STOCK[].shelf — a mismatch is a hard
// error, so the racking rows are listed rather than generated.
export const SHELVES: ShelfSpec[] = [
  { name: "Rack-1", warehouse: "Main", storageType: "Rack" },
  { name: "B1-L1", warehouse: "Main", storageType: "Bin", parent: "Rack-1" },
  { name: "B1-L2", warehouse: "Main", storageType: "Bin", parent: "Rack-1" },
  { name: "B1-L3", warehouse: "Main", storageType: "Bin", parent: "Rack-1" },
  { name: "B2-L1", warehouse: "Main", storageType: "Bin", parent: "Rack-1" },
  { name: "B2-L2", warehouse: "Main", storageType: "Bin", parent: "Rack-1" },
  { name: "B2-L3", warehouse: "Main", storageType: "Bin", parent: "Rack-1" },
  { name: "B3-L1", warehouse: "Main", storageType: "Bin", parent: "Rack-1" },
  { name: "B3-L2", warehouse: "Main", storageType: "Bin", parent: "Rack-1" },
  { name: "B3-L3", warehouse: "Main", storageType: "Bin", parent: "Rack-1" },
  // Bar, plate and tube live on cantilever racking, not in bins.
  { name: "Bar-Stock", warehouse: "Main", storageType: "Shelf" }
];

export const PRINTER_ROUTE: PrinterRouteSpec = {
  name: "Traveler Label Printer",
  format: "zpl",
  printerUrl: "http://192.168.20.31:9100"
};

// Contractors are individuals who reference a supplierContact for their
// identity, so they need an agency supplier to hang off.
export const CONTRACTOR_AGENCY: ContractorAgencySpec = {
  name: "Rockford Technical Staffing",
  type: "Services",
  phone: "+1-815-555-0190"
};

export const CUSTOMER_TYPES = [
  "Hydraulics",
  "Instrumentation",
  "Agriculture",
  "Medical"
];

export const SUPPLIER_TYPES = [
  "Materials",
  "Hardware",
  "Finishing",
  "Heat Treating",
  "Tooling",
  "Services"
];

export const CUSTOMERS = [
  {
    name: "Cedar Valley Hydraulics",
    type: "Hydraulics",
    status: "Active",
    phone: "+1-319-555-0100",
    website: "https://cedarvalleyhydraulics.com"
  },
  {
    name: "Granite State Instruments",
    type: "Instrumentation",
    status: "Active",
    phone: "+1-603-555-0200",
    website: "https://granitestateinstruments.com"
  },
  {
    name: "Dominion Ag Equipment",
    type: "Agriculture",
    status: "Active",
    phone: "+1-804-555-0300",
    website: "https://dominionag.com"
  },
  {
    name: "Solstice Medical Devices",
    type: "Medical",
    status: "Lead",
    phone: "+1-612-555-0400",
    website: "https://solsticemedical.com"
  }
];

export const CUSTOMER_CONTACTS = [
  {
    customer: "Cedar Valley Hydraulics",
    firstName: "Marta",
    lastName: "Ellwood",
    email: "m.ellwood@cedarvalleyhydraulics.com",
    title: "Supply Chain Manager"
  },
  {
    customer: "Granite State Instruments",
    firstName: "Desmond",
    lastName: "Farrow",
    email: "dfarrow@granitestateinstruments.com",
    title: "Mechanical Engineering Lead"
  },
  {
    customer: "Dominion Ag Equipment",
    firstName: "Lucia",
    lastName: "Bertrand",
    email: "lbertrand@dominionag.com",
    title: "Commodity Buyer"
  },
  {
    customer: "Solstice Medical Devices",
    firstName: "Aaron",
    lastName: "Kestenbaum",
    email: "akestenbaum@solsticemedical.com",
    title: "NPI Program Manager"
  }
];

export const SUPPLIERS = [
  {
    name: "Rock River Metals",
    type: "Materials",
    phone: "+1-815-555-0110",
    website: "https://rockrivermetals.com"
  },
  {
    name: "Bluestem Alloys",
    type: "Materials",
    phone: "+1-262-555-0220",
    website: "https://bluestemalloys.com"
  },
  {
    name: "Fastline Industrial Supply",
    type: "Hardware",
    phone: "+1-847-555-0330",
    website: "https://fastlinesupply.com"
  },
  {
    name: "Midway Bearing & Seal",
    type: "Hardware",
    phone: "+1-773-555-0440",
    website: "https://midwaybearing.com"
  },
  {
    name: "Anvil Finishing Group",
    type: "Finishing",
    phone: "+1-815-555-0550",
    website: "https://anvilfinishing.com"
  },
  {
    name: "Forge Heat Treating",
    type: "Heat Treating",
    phone: "+1-309-555-0660",
    website: "https://forgeheattreat.com"
  },
  {
    name: "Precision Gauge Services",
    type: "Services",
    phone: "+1-608-555-0770",
    website: "https://precisiongauge.com"
  }
];

export const SUPPLIER_CONTACTS = [
  {
    supplier: "Rock River Metals",
    firstName: "Delia",
    lastName: "Ferraro",
    email: "dferraro@rockrivermetals.com",
    title: "Inside Sales"
  },
  {
    supplier: "Bluestem Alloys",
    firstName: "Wes",
    lastName: "Okonjo",
    email: "wokonjo@bluestemalloys.com",
    title: "Account Manager"
  },
  {
    supplier: "Fastline Industrial Supply",
    firstName: "Sondra",
    lastName: "Vlahos",
    email: "svlahos@fastlinesupply.com",
    title: "Territory Rep"
  },
  {
    supplier: "Midway Bearing & Seal",
    firstName: "Ken",
    lastName: "Ibarra",
    email: "kibarra@midwaybearing.com",
    title: "Applications Engineer"
  },
  {
    supplier: "Anvil Finishing Group",
    firstName: "Rhonda",
    lastName: "Pell",
    email: "rpell@anvilfinishing.com",
    title: "Scheduling Coordinator"
  },
  {
    supplier: "Forge Heat Treating",
    firstName: "Milan",
    lastName: "Drazic",
    email: "mdrazic@forgeheattreat.com",
    title: "Metallurgist"
  },
  {
    supplier: "Precision Gauge Services",
    firstName: "Bea",
    lastName: "Lundqvist",
    email: "blundqvist@precisiongauge.com",
    title: "Calibration Manager"
  }
];

// Backs the outside-processing steps in the routings — each `sp:` ref key is
// supplier + process, so two finishers can hold the same process.
export const SUPPLIER_PROCESSES = [
  { supplier: "Anvil Finishing Group", process: "Outside Processing" },
  { supplier: "Forge Heat Treating", process: "Outside Processing" },
  { supplier: "Anvil Finishing Group", process: "Deburr & Finish" },
  { supplier: "Precision Gauge Services", process: "Final Inspection" }
];

export const CONTRACTORS = [
  {
    firstName: "Ramon",
    lastName: "Delacruz",
    email: "r.delacruz@contractor.local",
    ability: "CNC Milling"
  },
  {
    firstName: "Priya",
    lastName: "Raghavan",
    email: "p.raghavan@contractor.local",
    ability: "Welding"
  }
];

export const PUMP_HOUSING_OP2_STEPS_V2: ProcedureStepSpec[] = [
  {
    name: "Verify the first-operation part against the traveler",
    type: "Checkbox",
    instruction:
      "Confirm the op-1 part number, heat lot and drawing revision on the traveler match the print supplied by the customer."
  },
  {
    name: "Confirm soft-jaw fixture seating",
    type: "Task",
    instruction:
      "Seat the part in TL-FIXT-HSG, sweep the datum face and confirm the indicator reads under 0.01 mm across the bore."
  },
  {
    name: "Measure the bearing bore diameter",
    type: "Measurement",
    instruction:
      "Bore-gauge the 52 mm bearing bore at three depths and record the largest reading in millimetres.",
    unitOfMeasureCode: "EA",
    minValue: 51.98,
    maxValue: 52.02
  },
  {
    name: "Measure bore-to-face perpendicularity",
    type: "Measurement",
    instruction:
      "Indicate the mounting face against the bore axis and record the total perpendicularity error in millimetres.",
    unitOfMeasureCode: "EA",
    minValue: 0,
    maxValue: 0.02
  },
  {
    name: "Record machinist",
    type: "Person",
    instruction: "Sign off as the machinist responsible for this operation."
  },
  {
    name: "Stage for anodize",
    type: "Task",
    instruction:
      "Wrap the bore, tag the basket with the outside-processing traveler and stage it on the OSP outbound cart.",
    required: false
  }
];

export const PROCEDURES: ProcedureSpec[] = [
  {
    name: "Pump Housing Second Operation",
    process: "CNC Milling",
    description:
      "Second-operation milling of the 6061 pump housing, including the bearing bore.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Verify the first-operation part against the traveler",
            type: "Checkbox",
            instruction:
              "Confirm the op-1 part number and drawing revision match the traveler."
          },
          {
            name: "Measure the bearing bore diameter",
            type: "Measurement",
            instruction:
              "Bore-gauge the 52 mm bearing bore once at mid-depth and record the reading in millimetres.",
            unitOfMeasureCode: "EA",
            minValue: 51.97,
            maxValue: 52.03
          }
        ]
      },
      { version: 2, status: "Draft", steps: PUMP_HOUSING_OP2_STEPS_V2 }
    ]
  },
  {
    name: "Manifold Assembly Build",
    process: "Mechanical Assembly",
    description:
      "Build and leak-prep of the HMA-4000 hydraulic manifold assembly.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Stage the kit at the assembly bench",
            type: "Checkbox",
            instruction:
              "Bring the manifold block, pump housing, drive shaft, piston rod, valve sub-assembly, base frame and enclosure panels to the bench and confirm each against the pick list."
          },
          {
            name: "Fit the manifold block to the base frame",
            type: "Task",
            instruction:
              "Locate the manifold block on the welded base frame, fit the mounting flanges and torque the M10 fasteners in a cross pattern."
          },
          {
            name: "Torque the manifold cap screws",
            type: "Measurement",
            instruction:
              "Torque the M10 manifold cap screws in a cross pattern and record the final torque wrench reading in Nm.",
            unitOfMeasureCode: "EA",
            minValue: 45,
            maxValue: 52
          },
          {
            name: "Measure assembled unit mass",
            type: "Measurement",
            instruction:
              "Weigh the assembled unit with the enclosure fitted and record the mass in pounds.",
            unitOfMeasureCode: "LB",
            minValue: 118,
            maxValue: 132
          },
          {
            name: "Record assembler",
            type: "Person",
            instruction: "Sign off as the assembler responsible for this unit."
          }
        ]
      }
    ]
  },
  {
    name: "Final Dimensional Inspection",
    process: "Final Inspection",
    description:
      "CMM report and certificate of conformance against the customer-supplied print.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Load the print revision into the CMM program",
            type: "Checkbox",
            instruction:
              "Confirm the CMM program revision matches the customer print revision recorded on the traveler before running the part."
          },
          {
            name: "Measure the critical port bore",
            type: "Measurement",
            instruction:
              "Run the CMM port-bore routine and record the reported diameter in millimetres.",
            unitOfMeasureCode: "EA",
            minValue: 24.97,
            maxValue: 25.03
          },
          {
            name: "Measure true position of the mounting pattern",
            type: "Measurement",
            instruction:
              "Record the worst-case true position of the four mounting holes in millimetres.",
            unitOfMeasureCode: "EA",
            minValue: 0,
            maxValue: 0.15
          },
          {
            name: "Attach the CMM report to the certificate of conformance",
            type: "Task",
            instruction:
              "Print the CMM report, attach it to the CoC and file both against the job before release to shipping."
          }
        ]
      }
    ]
  }
];

export const SHIPPING_METHODS = [
  "UPS Ground",
  "UPS Next Day Air",
  "FedEx Freight",
  "Customer Pickup",
  "Hot Shot Courier"
];

export const SHIPPING_TERMS = [
  "FOB Origin",
  "FOB Destination",
  "Net 30 EOM",
  "Collect"
];

export const ITEM_POSTING_GROUPS = [
  "Raw Material",
  "Finished Goods",
  "WIP",
  "Shop Supplies",
  "Outside Services"
];

export const COST_CENTERS = [
  "Direct Labor",
  "Machining Overhead",
  "Engineering",
  "G&A"
];

export const NO_QUOTE_REASONS = [
  "Capacity Constraint",
  "Tolerance Beyond Capability",
  "No Margin",
  "Material Not Sourced"
];

export const precisionFoundation: FoundationData = {
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
  partyAddressCity: "Rockford",
  partyAddressStateProvince: "IL",
  partyAddressPostalCode: "61104",
  partyAddressCountryCode: "US"
};
