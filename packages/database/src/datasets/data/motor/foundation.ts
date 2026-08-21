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
// Precision electric motor theme — Torque Dynamics LLC.
// ---------------------------------------------------------------------------

export const DEPT_NAMES = [
  "Engineering",
  "Machining",
  "Winding",
  "Assembly",
  "Quality"
];

export const ABILITIES = [
  "CNC Machining",
  "Coil Winding",
  "Magnet Handling",
  "Rotor Balancing",
  "Precision Assembly",
  "Electrical Test",
  "Inspection"
];

// Three separate inspection processes, not one — a motor shop inspects incoming
// magnet lots, in-process stators and the finished machine on the dyno, and each
// belongs to a different work center.
export const PROCESSES = [
  { name: "CNC Machining", factor: "Minutes/Piece", type: "Process" },
  { name: "Lamination Stacking", factor: "Minutes/Piece", type: "Process" },
  { name: "Coil Winding", factor: "Hours/Piece", type: "Process" },
  { name: "Varnish Impregnation", factor: "Total Hours", type: "Process" },
  { name: "Rotor Balancing", factor: "Minutes/Piece", type: "Process" },
  { name: "Motor Assembly", factor: "Hours/Piece", type: "Assembly" },
  { name: "Incoming Inspection", factor: "Minutes/Piece", type: "Inspection" },
  {
    name: "In-Process Inspection",
    factor: "Minutes/Piece",
    type: "Inspection"
  },
  {
    name: "Final Test & Inspection",
    factor: "Hours/Piece",
    type: "Inspection"
  },
  { name: "Outside Processing", factor: "Total Hours", type: "Process" }
];

export const WORK_CENTERS = [
  {
    name: "CNC Turning Cell",
    dept: "Machining",
    ability: "CNC Machining",
    laborRate: 76,
    machineRate: 105
  },
  {
    name: "Lamination Press",
    dept: "Machining",
    ability: "CNC Machining",
    laborRate: 68,
    machineRate: 90
  },
  {
    name: "Winding Line 1",
    dept: "Winding",
    ability: "Coil Winding",
    laborRate: 72,
    machineRate: 55
  },
  {
    name: "Impregnation Oven",
    dept: "Winding",
    ability: "Coil Winding",
    laborRate: 58,
    machineRate: 45
  },
  {
    name: "Balancing Cell",
    dept: "Machining",
    ability: "Rotor Balancing",
    laborRate: 80,
    machineRate: 70
  },
  {
    name: "Motor Assembly Bench",
    dept: "Assembly",
    ability: "Precision Assembly",
    laborRate: 84,
    machineRate: 0
  },
  {
    name: "Dyno Test Cell",
    dept: "Quality",
    ability: "Electrical Test",
    laborRate: 90,
    machineRate: 65
  },
  {
    name: "CMM Inspection Bench",
    dept: "Quality",
    ability: "Inspection",
    laborRate: 74,
    machineRate: 0
  }
];

// Most cells run more than one process — a machining cell also checks its own
// work, and the inspection bench covers all three inspection stages.
export const WORK_CENTER_PROCESS_LINKS: Array<[string, string]> = [
  ["CNC Turning Cell", "CNC Machining"],
  ["CNC Turning Cell", "In-Process Inspection"],
  ["Lamination Press", "Lamination Stacking"],
  ["Lamination Press", "CNC Machining"],
  ["Winding Line 1", "Coil Winding"],
  ["Winding Line 1", "In-Process Inspection"],
  ["Impregnation Oven", "Varnish Impregnation"],
  ["Balancing Cell", "Rotor Balancing"],
  ["Balancing Cell", "CNC Machining"],
  ["Balancing Cell", "In-Process Inspection"],
  ["Motor Assembly Bench", "Motor Assembly"],
  ["Motor Assembly Bench", "In-Process Inspection"],
  ["Dyno Test Cell", "Final Test & Inspection"],
  ["Dyno Test Cell", "In-Process Inspection"],
  ["CMM Inspection Bench", "In-Process Inspection"],
  ["CMM Inspection Bench", "Incoming Inspection"],
  ["CMM Inspection Bench", "Final Test & Inspection"]
];

export const PLANT: PlantSpec = {
  name: "Motor Assembly Plant",
  addressLine1: "1450 Meyer Industrial Road",
  city: "Fort Wayne",
  stateProvince: "IN",
  postalCode: "46803",
  countryCode: "US",
  timezone: "America/Indiana/Indianapolis"
};

export const SHIFTS: ShiftSpec[] = [
  {
    name: "A Shift",
    startTime: "05:30:00",
    endTime: "14:00:00",
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true
  },
  {
    name: "B Shift",
    startTime: "14:00:00",
    endTime: "22:30:00",
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true
  },
  {
    name: "Saturday Shift",
    startTime: "06:00:00",
    endTime: "18:00:00",
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
  { key: "RMA", name: "RMA / Warranty Returns" },
  { key: "QC", name: "Incoming Inspection Hold", requiresBin: true }
];

export const STORAGE_TYPES = ["Shelf", "Bin", "Rack", "Cabinet"];

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
  // Rare-earth magnets are kept locked and away from anything ferrous.
  { name: "Magnet-Vault", warehouse: "Main", storageType: "Cabinet" },
  { name: "Winding-Crib", warehouse: "Main", storageType: "Shelf" }
];

export const PRINTER_ROUTE: PrinterRouteSpec = {
  name: "Motor Nameplate Printer",
  format: "zpl",
  printerUrl: "http://192.168.20.31:9100"
};

// Contractors are individuals who reference a supplierContact for their
// identity, so they need an agency supplier to hang off.
export const CONTRACTOR_AGENCY: ContractorAgencySpec = {
  name: "Three Rivers Technical Services",
  type: "Services",
  phone: "+1-260-555-0170"
};

export const CUSTOMER_TYPES = [
  "Industrial OEM",
  "Automotive",
  "Aerospace",
  "Distribution"
];

export const SUPPLIER_TYPES = [
  "Magnets",
  "Electrical",
  "Materials",
  "Hardware",
  "Contract Manufacturer",
  "Services"
];

export const CUSTOMERS = [
  {
    name: "Ridgeline Drive Systems",
    type: "Industrial OEM",
    status: "Active",
    phone: "+1-616-555-0110",
    website: "https://ridgelinedrives.com"
  },
  {
    name: "Cardinal Motorworks",
    type: "Automotive",
    status: "Active",
    phone: "+1-317-555-0220",
    website: "https://cardinalmotorworks.com"
  },
  {
    name: "Halcyon Aerospace Actuation",
    type: "Aerospace",
    status: "Active",
    phone: "+1-316-555-0330",
    website: "https://halcyonactuation.com"
  },
  {
    name: "Wabash Industrial Supply",
    type: "Distribution",
    status: "Lead",
    phone: "+1-765-555-0440",
    website: "https://wabashindustrial.com"
  }
];

export const CUSTOMER_CONTACTS = [
  {
    customer: "Ridgeline Drive Systems",
    firstName: "Priya",
    lastName: "Raghavan",
    email: "p.raghavan@ridgelinedrives.com",
    title: "Drive Systems Engineering Manager"
  },
  {
    customer: "Cardinal Motorworks",
    firstName: "Wes",
    lastName: "Talbot",
    email: "wtalbot@cardinalmotorworks.com",
    title: "Supplier Quality Lead"
  },
  {
    customer: "Halcyon Aerospace Actuation",
    firstName: "Marguerite",
    lastName: "Ferreira",
    email: "mferreira@halcyonactuation.com",
    title: "Actuation Program Manager"
  },
  {
    customer: "Wabash Industrial Supply",
    firstName: "Terrell",
    lastName: "Boone",
    email: "tboone@wabashindustrial.com",
    title: "Category Buyer"
  }
];

export const SUPPLIERS = [
  {
    name: "Meridian Magnetics",
    type: "Magnets",
    phone: "+1-330-555-0510",
    website: "https://meridianmagnetics.com"
  },
  {
    name: "Copperline Wire Works",
    type: "Electrical",
    phone: "+1-513-555-0620",
    website: "https://copperlinewire.com"
  },
  {
    name: "Lakeland Electrical Steel",
    type: "Materials",
    phone: "+1-219-555-0730",
    website: "https://lakelandsteel.com"
  },
  {
    name: "Summit Bearing Supply",
    type: "Hardware",
    phone: "+1-847-555-0840",
    website: "https://summitbearing.com"
  },
  {
    name: "Ironwood Fasteners",
    type: "Hardware",
    phone: "+1-630-555-0950",
    website: "https://ironwoodfasteners.com"
  },
  {
    name: "Maumee Contract Machining",
    type: "Contract Manufacturer",
    phone: "+1-419-555-1060",
    website: "https://maumeemachining.com"
  },
  {
    name: "Anchor Metrology Services",
    type: "Services",
    phone: "+1-937-555-1170",
    website: "https://anchormetrology.com"
  }
];

export const SUPPLIER_CONTACTS = [
  {
    supplier: "Meridian Magnetics",
    firstName: "Yusuf",
    lastName: "Demir",
    email: "y.demir@meridianmagnetics.com",
    title: "Account Manager"
  },
  {
    supplier: "Copperline Wire Works",
    firstName: "Annika",
    lastName: "Persson",
    email: "apersson@copperlinewire.com",
    title: "Technical Sales"
  },
  {
    supplier: "Lakeland Electrical Steel",
    firstName: "Marcus",
    lastName: "Dellinger",
    email: "mdellinger@lakelandsteel.com",
    title: "Inside Sales"
  },
  {
    supplier: "Summit Bearing Supply",
    firstName: "Corinne",
    lastName: "Baptiste",
    email: "cbaptiste@summitbearing.com",
    title: "Sales Engineer"
  },
  {
    supplier: "Ironwood Fasteners",
    firstName: "Dev",
    lastName: "Chaudhary",
    email: "dchaudhary@ironwoodfasteners.com",
    title: "Sales Rep"
  },
  {
    supplier: "Maumee Contract Machining",
    firstName: "Lindsay",
    lastName: "Okonkwo",
    email: "lokonkwo@maumeemachining.com",
    title: "Account Rep"
  },
  {
    supplier: "Anchor Metrology Services",
    firstName: "Boris",
    lastName: "Kaminski",
    email: "bkaminski@anchormetrology.com",
    title: "Calibration Coordinator"
  }
];

export const SUPPLIER_PROCESSES = [
  { supplier: "Maumee Contract Machining", process: "CNC Machining" },
  { supplier: "Maumee Contract Machining", process: "Rotor Balancing" },
  // Backs the outside-processing (shaft nitride, housing anodize) steps.
  { supplier: "Maumee Contract Machining", process: "Outside Processing" }
];

export const CONTRACTORS = [
  {
    firstName: "Elena",
    lastName: "Marchetti",
    email: "e.marchetti@contractor.local",
    ability: "Coil Winding"
  },
  {
    firstName: "Desmond",
    lastName: "Okafor",
    email: "d.okafor@contractor.local",
    ability: "CNC Machining"
  }
];

export const STATOR_WINDING_STEPS_V2: ProcedureStepSpec[] = [
  {
    name: "Verify slot liner installation",
    type: "Checkbox",
    instruction:
      "Confirm every stator slot carries a full-length Nomex liner with the cuff folded and no tearing at the slot mouth."
  },
  {
    name: "Record winding resistance per phase",
    type: "Measurement",
    instruction:
      "Measure phase-to-phase resistance at 20 degC with the bridge and record the value in milliohms.",
    unitOfMeasureCode: "EA",
    minValue: 118,
    maxValue: 132
  },
  {
    name: "Insulation resistance at 500 V",
    type: "Measurement",
    instruction:
      "Megger each phase to the core at 500 V for 60 seconds and record the lowest reading in megohms.",
    unitOfMeasureCode: "EA",
    minValue: 100,
    maxValue: 10000
  },
  {
    name: "Record winder",
    type: "Person",
    instruction: "Sign off as the winder responsible for this stator."
  },
  {
    name: "Stage for impregnation",
    type: "Task",
    instruction:
      "Mask the bore and the terminal leads, hang the stator on the oven rack and apply the job label.",
    required: false
  }
];

export const PROCEDURES: ProcedureSpec[] = [
  {
    name: "Stator Winding & Impregnation",
    process: "Coil Winding",
    description:
      "Coil insertion, lacing and Class H varnish impregnation for a 9000-frame stator.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Verify slot liner installation",
            type: "Checkbox",
            instruction: "Confirm every stator slot carries a Nomex liner."
          },
          {
            name: "Record winding resistance per phase",
            type: "Measurement",
            instruction:
              "Measure phase-to-phase resistance and record the value in milliohms.",
            unitOfMeasureCode: "EA",
            minValue: 115,
            maxValue: 135
          }
        ]
      },
      { version: 2, status: "Draft", steps: STATOR_WINDING_STEPS_V2 }
    ]
  },
  {
    name: "In-Process Stator Inspection",
    process: "In-Process Inspection",
    description:
      "Post-impregnation dimensional and electrical check before a stator is released to assembly.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Measure bore diameter after impregnation",
            type: "Measurement",
            instruction:
              "Measure the stator bore at three axial stations on the CMM and record the largest reading in millimetres.",
            unitOfMeasureCode: "EA",
            minValue: 89.94,
            maxValue: 90.06
          },
          {
            name: "Surge comparison test",
            type: "Checkbox",
            instruction:
              "Run a 1.5 kV surge comparison across all three phases and confirm the traces overlay with no collapse."
          },
          {
            name: "Inspect varnish coverage",
            type: "Checkbox",
            instruction:
              "Confirm full varnish coverage on both end turns with no runs into the bore or onto the mounting face."
          }
        ]
      }
    ]
  },
  {
    name: "Rotor Balance Verification",
    process: "Rotor Balancing",
    description:
      "Two-plane dynamic balance and residual unbalance check for a magnet-bonded rotor.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Mount rotor on the balancing mandrel",
            type: "Task",
            instruction:
              "Fit the rotor to the mandrel, confirm zero runout at both journals and dial in the machine for the frame size."
          },
          {
            name: "Record residual unbalance",
            type: "Measurement",
            instruction:
              "Run the balance cycle at rated speed and record the worst-plane residual unbalance in gram-millimetres.",
            unitOfMeasureCode: "EA",
            minValue: 0,
            maxValue: 2.5
          },
          {
            name: "Confirm magnet bond integrity",
            type: "Checkbox",
            instruction:
              "After balancing, tap-test every magnet segment and confirm no bond line has opened."
          },
          {
            name: "Record balancing technician",
            type: "Person",
            instruction: "Sign off as the technician who balanced this rotor."
          }
        ]
      }
    ]
  },
  {
    name: "Incoming Magnet Lot Inspection",
    process: "Incoming Inspection",
    description:
      "Lot acceptance for rare-earth magnet segments before they reach the magnet vault.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Verify lot certificate against the purchase order",
            type: "Checkbox",
            instruction:
              "Confirm the grade, coating and lot number on the mill certificate match the purchase order line."
          },
          {
            name: "Measure segment thickness",
            type: "Measurement",
            instruction:
              "Measure five segments from the lot with the micrometer and record the largest thickness in millimetres.",
            unitOfMeasureCode: "EA",
            minValue: 4.9,
            maxValue: 5.1
          },
          {
            name: "Measure surface flux density",
            type: "Measurement",
            instruction:
              "Gauss-meter five segments at the pole face and record the lowest reading in millitesla.",
            unitOfMeasureCode: "EA",
            minValue: 480,
            maxValue: 560
          },
          {
            name: "Inspect coating for chips",
            type: "Checkbox",
            instruction:
              "Inspect the sample under 10x for chipped or lifted nickel plating on any edge."
          }
        ]
      }
    ]
  },
  {
    name: "Motor Final Assembly",
    process: "Motor Assembly",
    description:
      "Rotor insertion, bearing fit and terminal box build for a finished motor.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Stage subassemblies at the bench",
            type: "Checkbox",
            instruction:
              "Bring the stator, rotor, housing and terminal box to the bench and confirm each serial against the traveler."
          },
          {
            name: "Grease and press the bearings",
            type: "Task",
            instruction:
              "Pack both bearings to one third fill, press them onto the shaft journals with the arbor fixture and confirm full seating."
          },
          {
            name: "Measure air gap after rotor insertion",
            type: "Measurement",
            instruction:
              "Feeler-gauge the air gap at four positions 90 degrees apart and record the smallest reading in millimetres.",
            unitOfMeasureCode: "EA",
            minValue: 0.45,
            maxValue: 0.65
          },
          {
            name: "Record assembler",
            type: "Person",
            instruction: "Sign off as the assembler responsible for this motor."
          }
        ]
      }
    ]
  },
  {
    name: "Dynamometer Acceptance Test",
    process: "Final Test & Inspection",
    description:
      "No-load, loaded and thermal acceptance run on the dyno before the motor is released to stock.",
    versions: [
      {
        version: 1,
        status: "Draft",
        steps: [
          {
            name: "Couple the motor to the dyno",
            type: "Task",
            instruction:
              "Mount the motor on the test bed, align the coupling within 0.05 mm and connect the drive and thermocouples."
          },
          {
            name: "Record no-load current",
            type: "Measurement",
            instruction:
              "Run at rated speed with no load for ten minutes and record the steady-state line current in amps.",
            unitOfMeasureCode: "EA",
            minValue: 0,
            maxValue: 3.2
          },
          {
            name: "Record torque at rated load",
            type: "Measurement",
            instruction:
              "Load the motor to rated current and record the measured shaft torque in newton-metres.",
            unitOfMeasureCode: "EA",
            minValue: 27.5,
            maxValue: 30.5
          },
          {
            name: "Record winding temperature rise",
            type: "Measurement",
            instruction:
              "Hold rated load for one hour and record the winding temperature rise over ambient in degrees Celsius.",
            unitOfMeasureCode: "EA",
            minValue: 0,
            maxValue: 80
          },
          {
            name: "Attach the acceptance data package",
            type: "Checkbox",
            instruction:
              "Print the dyno curve, stamp the nameplate serial on it and file it against the job."
          }
        ]
      }
    ]
  }
];

export const SHIPPING_METHODS = [
  "UPS Ground",
  "UPS 2nd Day Air",
  "FedEx Ground",
  "LTL Freight",
  "Will Call"
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
  "Tooling Cost"
];

export const motorFoundation: FoundationData = {
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
  partyAddressCity: "Fort Wayne",
  partyAddressStateProvince: "IN",
  partyAddressPostalCode: "46803",
  partyAddressCountryCode: "US"
};
