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
// Industrial robotics theme — Helix Robotics Inc.
// ---------------------------------------------------------------------------

export const DEPT_NAMES = [
  "Engineering",
  "Machining",
  "Assembly & Integration",
  "Quality"
];
export const ABILITIES = [
  "CNC Machining",
  "Precision Assembly",
  "Electrical Wiring",
  "PCB Rework",
  "Inspection",
  "Robot Programming"
];
export const PROCESSES = [
  { name: "CNC Machining", factor: "Minutes/Piece", type: "Process" },
  {
    name: "Sheet Metal Fabrication",
    factor: "Minutes/Piece",
    type: "Process"
  },
  { name: "Gearbox Assembly", factor: "Hours/Piece", type: "Assembly" },
  { name: "PCB Assembly", factor: "Minutes/Piece", type: "Process" },
  { name: "Harness Build", factor: "Hours/Piece", type: "Process" },
  { name: "Robot Integration", factor: "Hours/Piece", type: "Assembly" },
  { name: "Burn-In Test", factor: "Total Hours", type: "Inspection" },
  { name: "Final Inspection", factor: "Hours/Piece", type: "Inspection" },
  { name: "Outside Processing", factor: "Total Hours", type: "Process" }
];

export const WORK_CENTERS = [
  {
    name: "CNC Mill Cell",
    dept: "Machining",
    ability: "CNC Machining",
    laborRate: 78,
    machineRate: 110
  },
  {
    name: "Gearbox Bench",
    dept: "Assembly & Integration",
    ability: "Precision Assembly",
    laborRate: 82,
    machineRate: 0
  },
  {
    name: "SMT Line",
    dept: "Assembly & Integration",
    ability: "PCB Rework",
    laborRate: 88,
    machineRate: 60
  },
  {
    name: "Harness Bench",
    dept: "Assembly & Integration",
    ability: "Electrical Wiring",
    laborRate: 65,
    machineRate: 0
  },
  {
    name: "Integration Cell 1",
    dept: "Assembly & Integration",
    ability: "Robot Programming",
    laborRate: 95,
    machineRate: 25
  },
  {
    name: "Burn-In Rack",
    dept: "Quality",
    ability: "Inspection",
    laborRate: 60,
    machineRate: 40
  },
  {
    name: "Inspection Bench",
    dept: "Quality",
    ability: "Inspection",
    laborRate: 72,
    machineRate: 0
  }
];

// Link work centers to processes. Most cells are capable of several — the
// integration cell in particular absorbs subassembly work when it is idle.
export const WORK_CENTER_PROCESS_LINKS: Array<[string, string]> = [
  ["CNC Mill Cell", "CNC Machining"],
  ["CNC Mill Cell", "Sheet Metal Fabrication"],
  ["Gearbox Bench", "Gearbox Assembly"],
  ["Gearbox Bench", "Final Inspection"],
  ["SMT Line", "PCB Assembly"],
  ["SMT Line", "Burn-In Test"],
  ["Harness Bench", "Harness Build"],
  ["Harness Bench", "PCB Assembly"],
  ["Integration Cell 1", "Robot Integration"],
  ["Integration Cell 1", "Gearbox Assembly"],
  ["Integration Cell 1", "Harness Build"],
  ["Burn-In Rack", "Burn-In Test"],
  ["Burn-In Rack", "Final Inspection"],
  ["Inspection Bench", "Final Inspection"],
  ["Inspection Bench", "Burn-In Test"]
];

export const PLANT: PlantSpec = {
  name: "Robotics Assembly Plant",
  addressLine1: "2200 Technology Drive",
  city: "Pittsburgh",
  stateProvince: "PA",
  postalCode: "15219",
  countryCode: "US",
  timezone: "America/New_York"
};

// Three shifts — an automation shop running near-continuous cells, unlike the
// two-shift aerospace story.
export const SHIFTS: ShiftSpec[] = [
  {
    name: "First Shift",
    startTime: "06:00:00",
    endTime: "14:30:00",
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true
  },
  {
    name: "Second Shift",
    startTime: "14:30:00",
    endTime: "23:00:00",
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true
  },
  {
    name: "Weekend Shift",
    startTime: "07:00:00",
    endTime: "19:00:00",
    saturday: true,
    sunday: true
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
  { key: "RMA", name: "RMA / Field Returns" },
  { key: "QC", name: "Incoming Inspection Hold", requiresBin: true }
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
  // Electrostatic-sensitive stock (drives, PCBs, encoders) lives apart.
  { name: "ESD-Cage", warehouse: "Main", storageType: "Shelf" }
];

export const PRINTER_ROUTE: PrinterRouteSpec = {
  name: "Assembly Label Printer",
  format: "zpl",
  printerUrl: "http://192.168.10.42:9100"
};

// Contractors are individuals who reference a supplierContact for their
// identity, so they need an agency supplier to hang off.
export const CONTRACTOR_AGENCY: ContractorAgencySpec = {
  name: "Keystone Technical Staffing",
  type: "Services",
  phone: "+1-412-555-0180"
};

export const CUSTOMER_TYPES = [
  "Automotive",
  "System Integrator",
  "Electronics",
  "Research"
];

export const SUPPLIER_TYPES = [
  "Motion Control",
  "Electronics",
  "Materials",
  "Hardware",
  "Contract Manufacturer",
  "Services"
];

export const CUSTOMERS = [
  {
    name: "Lakeshore Automotive",
    type: "Automotive",
    status: "Active",
    phone: "+1-313-555-0100",
    website: "https://lakeshoreauto.com"
  },
  {
    name: "Cascade Integration Group",
    type: "System Integrator",
    status: "Active",
    phone: "+1-503-555-0200",
    website: "https://cascadeintegration.com"
  },
  {
    name: "Northwind Electronics",
    type: "Electronics",
    status: "Active",
    phone: "+1-408-555-0300",
    website: "https://northwindelectronics.com"
  },
  {
    name: "Alpine Research Institute",
    type: "Research",
    status: "Lead",
    phone: "+1-608-555-0400",
    website: "https://alpineresearch.edu"
  }
];

export const CUSTOMER_CONTACTS = [
  {
    customer: "Lakeshore Automotive",
    firstName: "Dana",
    lastName: "Whitfield",
    email: "d.whitfield@lakeshoreauto.com",
    title: "Manufacturing Engineering Manager"
  },
  {
    customer: "Cascade Integration Group",
    firstName: "Tomas",
    lastName: "Aguilar",
    email: "taguilar@cascadeintegration.com",
    title: "Director of Procurement"
  },
  {
    customer: "Northwind Electronics",
    firstName: "Mei",
    lastName: "Lin",
    email: "mlin@northwindelectronics.com",
    title: "Automation Lead"
  },
  {
    customer: "Alpine Research Institute",
    firstName: "Dr. Elias",
    lastName: "Rahn",
    email: "erahn@alpineresearch.edu",
    title: "Principal Investigator"
  }
];

export const SUPPLIERS = [
  {
    name: "Kestrel Motion",
    type: "Motion Control",
    phone: "+1-508-555-0500",
    website: "https://kestrelmotion.com"
  },
  {
    name: "Torqline Gearing",
    type: "Motion Control",
    phone: "+1-847-555-0600",
    website: "https://torqline.com"
  },
  {
    name: "Northgate Electronics",
    type: "Electronics",
    phone: "+1-408-555-0700",
    website: "https://northgateelec.com"
  },
  {
    name: "Ironbark Metals",
    type: "Materials",
    phone: "+1-216-555-0800",
    website: "https://ironbarkmetals.com"
  },
  {
    name: "Precision Fasteners Co",
    type: "Hardware",
    phone: "+1-630-555-0900",
    website: "https://precisionfasteners.com"
  },
  {
    name: "Kappa Contract Machining",
    type: "Contract Manufacturer",
    phone: "+1-414-555-1000",
    website: "https://kappamachining.com"
  },
  {
    name: "Vertex Calibration Services",
    type: "Services",
    phone: "+1-919-555-1100",
    website: "https://vertexcal.com"
  }
];

export const SUPPLIER_CONTACTS = [
  {
    supplier: "Kestrel Motion",
    firstName: "Hana",
    lastName: "Sato",
    email: "h.sato@kestrelmotion.com",
    title: "Account Manager"
  },
  {
    supplier: "Torqline Gearing",
    firstName: "Gregor",
    lastName: "Vasilenko",
    email: "gvasilenko@torqline.com",
    title: "Technical Sales"
  },
  {
    supplier: "Northgate Electronics",
    firstName: "Rosa",
    lastName: "Delgado",
    email: "rdelgado@northgateelec.com",
    title: "Sales Engineer"
  },
  {
    supplier: "Ironbark Metals",
    firstName: "Curtis",
    lastName: "Bramley",
    email: "cbramley@ironbarkmetals.com",
    title: "Inside Sales"
  },
  {
    supplier: "Precision Fasteners Co",
    firstName: "Nadia",
    lastName: "Petrov",
    email: "npetrov@precisionfasteners.com",
    title: "Sales Rep"
  },
  {
    supplier: "Kappa Contract Machining",
    firstName: "Owen",
    lastName: "Mbeki",
    email: "ombeki@kappamachining.com",
    title: "Account Rep"
  },
  {
    supplier: "Vertex Calibration Services",
    firstName: "Ingrid",
    lastName: "Halvorsen",
    email: "ihalvorsen@vertexcal.com",
    title: "Service Coordinator"
  }
];

// Supplier processes for the contract manufacturer
export const SUPPLIER_PROCESSES = [
  { supplier: "Kappa Contract Machining", process: "CNC Machining" },
  {
    supplier: "Kappa Contract Machining",
    process: "Sheet Metal Fabrication"
  },
  // Backs the outside-processing (hard anodize) step on the arm base.
  { supplier: "Kappa Contract Machining", process: "Outside Processing" }
];

export const CONTRACTORS = [
  {
    firstName: "Victor",
    lastName: "Salgado",
    email: "v.salgado@contractor.local",
    ability: "CNC Machining"
  },
  {
    firstName: "Bridget",
    lastName: "Nolan",
    email: "b.nolan@contractor.local",
    ability: "PCB Rework"
  }
];

export const ARM_BASE_STEPS_V2: ProcedureStepSpec[] = [
  {
    name: "Verify base kit against the pick list",
    type: "Checkbox",
    instruction:
      "Confirm the machined base casting, column, J1 gear set and both bearing sets are present and match the drawing revision on the traveler."
  },
  {
    name: "Torque J1 gearbox fasteners",
    type: "Measurement",
    instruction:
      "Torque the M8 gearbox mounting fasteners in a star pattern. Record the final torque wrench reading in Nm.",
    unitOfMeasureCode: "EA",
    minValue: 22,
    maxValue: 26
  },
  {
    name: "Measure J1 backlash",
    type: "Measurement",
    instruction:
      "Rotate the output flange against a fixed indicator and record the total backlash in arc-minutes.",
    unitOfMeasureCode: "EA",
    minValue: 0,
    maxValue: 1.5
  },
  {
    name: "Record assembler",
    type: "Person",
    instruction: "Sign off as the assembler responsible for this base."
  },
  {
    name: "Stage for link assembly",
    type: "Task",
    instruction:
      "Fit the shipping brace, apply the job label, and stage the base on the integration cart.",
    required: false
  }
];

export const PROCEDURES: ProcedureSpec[] = [
  {
    name: "Arm Base Assembly",
    process: "Gearbox Assembly",
    description:
      "Assembly and torque procedure for the J1 base and column of the Vertex 10 arm.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Verify base kit against the pick list",
            type: "Checkbox",
            instruction:
              "Confirm the machined base casting and column are present."
          },
          {
            name: "Torque J1 gearbox fasteners",
            type: "Measurement",
            instruction:
              "Torque the M8 gearbox mounting fasteners in a star pattern to 24 Nm.",
            unitOfMeasureCode: "EA",
            minValue: 23,
            maxValue: 25
          }
        ]
      },
      { version: 2, status: "Draft", steps: ARM_BASE_STEPS_V2 }
    ]
  },
  {
    name: "Robot Cell Integration",
    process: "Robot Integration",
    description:
      "Integration of the arm subassemblies and controller cabinet into a finished ROB-2000.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Stage subassemblies at the integration cell",
            type: "Checkbox",
            instruction:
              "Move the base, link assembly, wrist, controller cabinet and gripper into Integration Cell 1 and confirm each serial against the traveler."
          },
          {
            name: "Mate the link assembly to the base",
            type: "Task",
            instruction:
              "Seat the link assembly on the J1 output flange, torque the fastener ring in a star pattern and confirm the ground strap is bonded."
          },
          {
            name: "Route and dress the arm harness",
            type: "Checkbox",
            instruction:
              "Route HRN-ARM-001 through the internal raceways, tie at every clamp and confirm no connector is under strain at full J2 travel."
          },
          {
            name: "Measure assembled arm mass",
            type: "Measurement",
            instruction:
              "Weigh the assembled arm without the controller cabinet and record the mass in pounds.",
            unitOfMeasureCode: "LB",
            minValue: 245,
            maxValue: 265
          },
          {
            name: "Record integration lead",
            type: "Person",
            instruction:
              "Sign off as the integration lead responsible for this arm."
          }
        ]
      }
    ]
  },
  {
    name: "Burn-In Qualification Test",
    process: "Burn-In Test",
    description:
      "Twenty-four hour duty-cycle burn-in and repeatability check for an integrated arm.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Connect the controller and safety loop",
            type: "Task",
            instruction:
              "Cable the arm to its controller cabinet, close the safety loop and confirm every axis homes without a fault."
          },
          {
            name: "Measure J1 holding current at rest",
            type: "Measurement",
            instruction:
              "Hold the arm at the burn-in start pose and record the J1 holding current in amps.",
            unitOfMeasureCode: "EA",
            minValue: 0,
            maxValue: 1.2
          },
          {
            name: "Run 24 hours of duty-cycle motion",
            type: "Checkbox",
            instruction:
              "Run the burn-in trajectory at 80% rated speed and payload for 24 hours. Tick once the cycle completes with no faults logged."
          },
          {
            name: "Repeatability check at temperature",
            type: "Checkbox",
            instruction:
              "Run the ISO 9283 pose set immediately after the burn-in and confirm every axis stays inside +/- 0.03 mm."
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

export const roboticsFoundation: FoundationData = {
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
  partyAddressCity: "Pittsburgh",
  partyAddressStateProvince: "PA",
  partyAddressPostalCode: "15219",
  partyAddressCountryCode: "US"
};
