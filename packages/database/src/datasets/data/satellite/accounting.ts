// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  AccountingData,
  FixedAssetSpec,
  IndirectPoolSpec,
  JournalEntrySpec,
  LaborCategorySpec,
  MemoSpec,
  PaymentSpec,
  PeriodCloseTaskSpec,
  PlanningGroupSpec,
  ProjectSpec,
  TimesheetEntrySpec
} from "../../types.ts";

export const FIXED_ASSETS: FixedAssetSpec[] = [
  {
    key: "hvac",
    className: "Buildings",
    location: "Plant",
    name: "Clean Room HVAC System",
    description: "ISO Class 7 clean room air handling and filtration plant",
    serialNumber: "HVAC-CR7-88421",
    status: "Active",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    acquisitionCost: 85000,
    acquisitionOffset: -941,
    depreciationStartOffset: -910,
    accumulatedDepreciation: 0,
    // 80,750 / 120 = 672.92 per month x the 30 months from the depreciation
    // start to the run's period end
    depreciationCharge: 20187.5
  },
  {
    key: "cmm",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Coordinate Measuring Machine",
    description: "Bridge-type CMM used for first article inspection",
    serialNumber: "CMM-BR12-00317",
    status: "Active",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    acquisitionCost: 240000,
    acquisitionOffset: -521,
    depreciationStartOffset: -485,
    accumulatedDepreciation: 0,
    // 228,000 / 120 = 1,900 per month x the 16 months from the depreciation
    // start to the run's period end
    depreciationCharge: 30400
  },
  {
    key: "cnc",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "5-Axis CNC Machining Center",
    description: "Awaiting registration — acquisition cost booked on register",
    serialNumber: "CNC-5X-72094",
    status: "Draft",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    // A Draft asset has not been capitalized yet: the register drawer is what
    // supplies cost, acquisition date and depreciation start date.
    acquisitionCost: 0,
    acquisitionOffset: null,
    depreciationStartOffset: null,
    accumulatedDepreciation: 0
  },
  {
    key: "van",
    className: "Vehicles",
    location: "HQ",
    name: "Delivery Van",
    description: "Cargo van for local supplier pickups",
    serialNumber: "VIN-1FTBW2CM7KKA10293",
    status: "Fully Depreciated",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 60,
    residualValuePercent: 0,
    acquisitionCost: 48000,
    acquisitionOffset: -2617,
    depreciationStartOffset: -2586,
    accumulatedDepreciation: 48000
  },
  {
    key: "tvac",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Legacy Thermal Vacuum Chamber",
    description:
      "1.2 m TVAC chamber retired after the 2 m chamber came online; sold to a university lab",
    serialNumber: "TVAC-12-04417",
    status: "Disposed",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    acquisitionCost: 180000,
    acquisitionOffset: -2900,
    depreciationStartOffset: -2880,
    // 171,000 / 120 = 1,425 per month x the 93 months depreciated before sale.
    // NBV 47,475 against 52,000 proceeds books a 4,525 gain.
    accumulatedDepreciation: 132525,
    disposal: { dateOffset: -50, method: "Sale", saleProceeds: 52000 }
  },
  {
    key: "laser",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Fiber Laser Cutter",
    description:
      "6 kW fiber laser for bracket and panel blanks, depreciated by cutting hours",
    serialNumber: "FLC-6K-30982",
    status: "Active",
    depreciationMethod: "Units of Production",
    usefulLifeMonths: 96,
    residualValuePercent: 0,
    acquisitionCost: 96000,
    acquisitionOffset: -120,
    depreciationStartOffset: -100,
    // 96,000 / 40,000 hours = 2.40 per hour. The first logged month (310 h)
    // was booked on registration; the run's month (420 h) is the charge.
    assetLifetimeUsage: 40000,
    accumulatedDepreciation: 744,
    usageLogs: [
      { monthsBack: 2, unitsProduced: 310 },
      { monthsBack: 1, unitsProduced: 420 }
    ],
    depreciationCharge: 1008
  }
];

export const JOURNAL_ENTRIES: JournalEntrySpec[] = [
  {
    ref: "journal:revenue",
    journalEntryId: "JE-SEED-001",
    description: "Revenue recognition — ORBSEC partial delivery",
    status: "Draft",
    postingOffset: -256,
    lines: [
      {
        accountClass: "Asset",
        description: "ORBSEC contract milestone",
        amount: 1800000,
        quantity: 1,
        journalLineReference: "JE-SEED-001"
      },
      {
        // Positive on a Revenue account IS the credit — the journalEntries view
        // derives debit/credit from account class AND sign, so a negative here
        // reads as a second debit and the entry blocks period close.
        accountClass: "Revenue",
        description: "ORBSEC contract milestone",
        amount: 1800000,
        quantity: 1,
        journalLineReference: "JE-SEED-001"
      }
    ]
  },
  {
    ref: "journal:payroll-accrual",
    journalEntryId: "JE-SEED-002",
    description: "Payroll accrual — integration & test crew, final week",
    status: "Posted",
    postingOffset: -12,
    lines: [
      {
        account: "6060",
        description: "Accrued I&T technician wages",
        amount: 48500,
        quantity: 1,
        journalLineReference: "JE-SEED-002-1",
        dimensions: [
          { dimension: "Project", value: "orbsec-block2" },
          { dimension: "Mission Phase", value: "Integration & Test" }
        ]
      },
      {
        account: "2150",
        description: "Accrued I&T technician wages",
        amount: 48500,
        quantity: 1,
        journalLineReference: "JE-SEED-002-2"
      }
    ]
  },
  {
    ref: "journal:amortization",
    journalEntryId: "JE-SEED-003",
    description: "Monthly amortization — orbit analysis software license",
    status: "Posted",
    postingOffset: -23,
    lines: [
      {
        account: "6310",
        description: "Orbit analysis license amortization",
        amount: 1250,
        quantity: 1,
        journalLineReference: "JE-SEED-003"
      },
      {
        // A credit on the contra-asset: negative on a debit-normal class.
        account: "1420",
        description: "Orbit analysis license amortization",
        amount: -1250,
        quantity: 1,
        journalLineReference: "JE-SEED-003"
      }
    ]
  },
  {
    ref: "journal:insurance-accrual",
    journalEntryId: "JE-SEED-004",
    description:
      "Accrued launch insurance premium — duplicate of broker invoice",
    status: "Reversed",
    postingOffset: -40,
    lines: [
      {
        account: "6100",
        description: "Launch insurance premium",
        amount: 9600,
        quantity: 1,
        journalLineReference: "JE-SEED-004"
      },
      {
        account: "2140",
        description: "Launch insurance premium",
        amount: 9600,
        quantity: 1,
        journalLineReference: "JE-SEED-004"
      }
    ],
    reversal: {
      ref: "journal:insurance-accrual-reversal",
      journalEntryId: "JE-SEED-005",
      postingOffset: -33
    }
  },
  {
    ref: "journal:opening-balance",
    journalEntryId: "JE-SEED-006",
    description: "Opening balances — cutover from the legacy ledger",
    status: "Posted",
    sourceType: "Opening Balance",
    postingOffset: -242,
    lines: [
      {
        account: "1010",
        description: "Operating cash",
        amount: 2400000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-1"
      },
      {
        account: "1210",
        description: "Raw materials on hand",
        amount: 380000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-2"
      },
      {
        account: "1220",
        description: "Finished goods on hand",
        amount: 520000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-3"
      },
      {
        account: "1350",
        description: "Machinery & equipment at cost",
        amount: 1850000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-4"
      },
      {
        account: "1330",
        description: "Accumulated depreciation to date",
        amount: -410000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-5"
      },
      {
        account: "2410",
        description: "Equipment term loan",
        amount: 1200000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-6"
      },
      {
        account: "3010",
        description: "Paid-in capital",
        amount: 2000000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-7"
      },
      {
        account: "3100",
        description: "Retained earnings brought forward",
        amount: 1540000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-8"
      }
    ]
  }
];

// Credit/Debit Note Issued invoices settle by their memos as zero-cash credit
// applications, the way applyCreditsToInvoices records them.
export const PAYMENTS: PaymentSpec[] = [
  {
    key: "orbsec-ach",
    type: "Receipt",
    customer: "ORBSEC Defense",
    dateOffset: -47,
    amount: 2000,
    reference: "ACH 0417-2286",
    applies: [{ invoiceKey: "paid", amount: 2000 }]
  },
  {
    key: "apex-wire",
    type: "Receipt",
    customer: "Apex Space Research",
    dateOffset: -12,
    amount: 21000,
    reference: "WIRE 88213 — milestone 1 of 2",
    applies: [{ invoiceKey: "partial", amount: 21000 }]
  },
  {
    key: "novasat-credit",
    type: "Receipt",
    customer: "NovaSat Networks",
    dateOffset: -50,
    amount: 0,
    reference: "Credit application",
    applies: [],
    credits: [{ memoKey: "novasat-valves", invoiceKey: "credit", amount: 2850 }]
  },
  {
    key: "celestial-ach",
    type: "Disbursement",
    supplier: "CelestialElex",
    dateOffset: -33,
    amount: 5610,
    reference: "ACH 1120-5561",
    applies: [{ invoiceKey: "paid", amount: 5610 }]
  },
  {
    key: "celestial-check",
    type: "Disbursement",
    supplier: "CelestialElex",
    dateOffset: -14,
    amount: 1640,
    reference: "CHK 10442",
    applies: [{ invoiceKey: "partial", amount: 1640 }]
  },
  {
    key: "proptech-debit",
    type: "Disbursement",
    supplier: "PropTech Solutions",
    dateOffset: -66,
    amount: 0,
    reference: "Debit application",
    applies: [],
    credits: [
      { memoKey: "proptech-tanks", invoiceKey: "debit-note", amount: 6400 }
    ]
  },
  {
    key: "draft-receipt",
    type: "Receipt",
    status: "Draft",
    customer: "NovaSat Networks",
    dateOffset: -1,
    amount: 4800,
    reference: "WIRE advice 4471 — propellant tank",
    applies: []
  },
  {
    key: "draft-disbursement",
    type: "Disbursement",
    status: "Draft",
    supplier: "Orbital Composites",
    dateOffset: 0,
    amount: 640,
    reference: "ACH batch 0930 — laminate",
    applies: []
  }
];

export const MEMOS: MemoSpec[] = [
  {
    key: "novasat-valves",
    direction: "Credit",
    customer: "NovaSat Networks",
    invoiceKey: "credit",
    dateOffset: -52,
    amount: 2850,
    notes:
      "Full credit — solenoid valves exceeded leak rate at NovaSat acceptance test"
  },
  {
    key: "proptech-tanks",
    direction: "Debit",
    supplier: "PropTech Solutions",
    invoiceKey: "debit-note",
    dateOffset: -70,
    amount: 6400,
    notes: "Both received propellant tanks failed weld X-ray — billing debited"
  }
];

export const PROJECTS: ProjectSpec[] = [
  {
    key: "orbsec-block2",
    name: "ORBSEC Constellation Block 2",
    description: "Eight-satellite follow-on build for ORBSEC Defense",
    identifier: "OB2",
    costTreatment: "Contract",
    status: "Released",
    // Government Contracting 5c: a Direct contract with budget control and
    // two control accounts. No earned value snapshot is seeded: the period
    // close writes them.
    costObjective: "Direct",
    budgetControl: "Warn",
    budgetTolerancePercent: 5,
    // Phase 2a: the contract keeps its own stock — two parts received for
    // it, and fasteners transferred in from common stock.
    projectStock: {
      openingStock: [
        {
          item: "FST-M6-A286",
          shelf: "A1-L1",
          qty: 100,
          unitCost: 5.5,
          dateOffset: -30
        },
        {
          item: "VLV-SOLENOID-LP",
          shelf: "A3-L2",
          qty: 4,
          unitCost: 950,
          dateOffset: -30
        }
      ],
      transfers: [
        {
          item: "FST-M4-TI",
          shelf: "A1-L1",
          qty: 50,
          reason:
            "Kit the Block 2 bus fasteners for the first two flight units",
          dateOffset: -12
        }
      ]
    },
    purchaseInvoiceLine: { invoiceKey: "paid", item: "BAT-LIION-48V" },
    milestones: [
      {
        key: "cdr",
        name: "Critical Design Review",
        startOffset: -60,
        endOffset: -10
      },
      {
        key: "flight-acceptance",
        name: "Flight Acceptance",
        startOffset: -9,
        endOffset: 45
      }
    ],
    elements: [
      {
        key: "bus",
        type: "System",
        name: "Satellite bus",
        state: "In Progress",
        budget: 180000,
        isControlAccount: true
      },
      {
        key: "req-power",
        type: "Requirement",
        name: "Bus supplies 1.2 kW at end of life",
        parentKey: "bus",
        state: "Done",
        milestone: "cdr"
      },
      {
        key: "task-array",
        type: "Task",
        name: "Size the solar array for end-of-life output",
        parentKey: "req-power",
        state: "Done",
        milestone: "cdr",
        estimatedHours: 24,
        earnedValueTechnique: "0/100"
      },
      {
        key: "tc-power",
        type: "Test Case",
        name: "Thermal-vacuum power balance test",
        parentKey: "req-power",
        state: "Todo",
        milestone: "flight-acceptance",
        estimatedHours: 16
      },
      {
        key: "req-mass",
        type: "Requirement",
        name: "Bus dry mass under 180 kg",
        parentKey: "bus",
        state: "In Review"
      },
      {
        key: "task-mass",
        type: "Task",
        name: "Update the mass budget after the harness redesign",
        parentKey: "req-mass",
        state: "In Progress",
        estimatedHours: 12,
        earnedValueTechnique: "50/50"
      },
      {
        key: "payload",
        type: "System",
        name: "Payload integration",
        state: "Todo",
        milestone: "flight-acceptance",
        budget: 95000,
        isControlAccount: true
      },
      {
        key: "req-pointing",
        type: "Requirement",
        name: "Payload pointing within 0.05 degrees",
        parentKey: "payload",
        state: "Todo"
      },
      {
        key: "task-alignment",
        type: "Task",
        name: "Align the star tracker to the payload boresight",
        parentKey: "req-pointing",
        state: "Backlog",
        milestone: "flight-acceptance",
        estimatedHours: 20,
        earnedValueTechnique: "Percent Complete",
        earnedValuePercent: 40,
        // Phase 3: the first two flight units' trackers, from the group.
        materials: [{ item: "ST-050", quantity: 2, requiredOffset: 20 }]
      },
      {
        key: "tc-pointing",
        type: "Test Case",
        name: "Pointing accuracy test on the air-bearing table",
        parentKey: "req-pointing",
        state: "Backlog",
        estimatedHours: 10,
        earnedValueTechnique: "Level of Effort",
        materials: [{ item: "ST-050", quantity: 1, requiredOffset: 60 }]
      }
    ]
  },
  {
    key: "novasat-gen3",
    name: "NovaSat Gen-3 Bus Qualification",
    description: "Qualification campaign for the next-generation bus structure",
    identifier: "NSG3",
    costTreatment: "Expense",
    status: "Released",
    milestones: [
      {
        key: "qual-plan",
        name: "Qualification Plan Approved",
        startOffset: -45,
        endOffset: -5
      },
      {
        key: "qual-complete",
        name: "Qualification Complete",
        startOffset: -4,
        endOffset: 75
      }
    ],
    elements: [
      {
        key: "structure",
        type: "System",
        name: "Gen-3 primary structure",
        item: "BUS-STR-001",
        state: "In Progress",
        budget: 120000
      },
      {
        key: "req-loads",
        type: "Requirement",
        name: "Survive a 14 g quasi-static launch load",
        parentKey: "structure",
        state: "In Progress",
        milestone: "qual-plan"
      },
      {
        key: "task-fem",
        type: "Task",
        name: "Correlate the finite element model to the modal survey",
        parentKey: "req-loads",
        state: "In Progress",
        milestone: "qual-complete",
        estimatedHours: 40
      },
      {
        key: "tc-sine",
        type: "Test Case",
        name: "Sine vibration qualification run",
        parentKey: "req-loads",
        state: "Todo",
        milestone: "qual-complete",
        estimatedHours: 16
      },
      {
        key: "req-stiffness",
        type: "Requirement",
        name: "First lateral mode above 45 Hz",
        parentKey: "structure",
        state: "Todo"
      },
      {
        key: "tc-modal",
        type: "Test Case",
        name: "Modal survey on the qualification unit",
        parentKey: "req-stiffness",
        state: "Todo",
        milestone: "qual-complete",
        estimatedHours: 12
      },
      {
        key: "thermal",
        type: "System",
        name: "Thermal control",
        state: "Backlog",
        budget: 40000
      },
      {
        key: "req-thermal",
        type: "Requirement",
        name: "Keep the battery between 0 and 30 °C",
        parentKey: "thermal",
        state: "Backlog"
      },
      {
        key: "task-heater",
        type: "Task",
        name: "Size the battery heater circuit",
        parentKey: "req-thermal",
        state: "Backlog",
        estimatedHours: 8
      },
      {
        key: "p-mass",
        type: "Parameter",
        name: "Primary structure mass",
        parentKey: "structure",
        state: "In Progress",
        parameter: { source: "Sum", unit: "kg" }
      },
      {
        key: "p-mass-a",
        type: "Parameter",
        name: "Panel mass",
        parentKey: "p-mass",
        state: "In Progress",
        parameter: { source: "Manual", value: 42, unit: "kg" }
      },
      {
        key: "p-mass-b",
        type: "Parameter",
        name: "Fitting mass",
        parentKey: "p-mass",
        state: "In Progress",
        parameter: { source: "Manual", value: 18, unit: "kg" }
      },
      {
        key: "req-mass-budget",
        type: "Requirement",
        name: "Primary structure mass at most 65 kg",
        parentKey: "structure",
        state: "In Review",
        requirement: {
          category: "Performance",
          operator: "≤",
          target: 65,
          unit: "kg",
          verificationMethod: "Test",
          actualParameter: "p-mass"
        }
      },
      {
        key: "tc-mass",
        type: "Test Case",
        name: "Weigh the qualification structure",
        parentKey: "req-mass-budget",
        state: "Done",
        verdict: "Pass"
      },
      {
        key: "p-supply",
        type: "Parameter",
        name: "Heater power available",
        parentKey: "structure",
        state: "In Progress",
        parameter: { source: "Manual", value: 30, unit: "W" }
      },
      {
        key: "p-load",
        type: "Parameter",
        name: "Heater power demand",
        parentKey: "structure",
        state: "In Progress",
        parameter: { source: "Manual", value: 26, unit: "W" }
      },
      {
        key: "p-margin",
        type: "Parameter",
        name: "Heater power margin",
        parentKey: "structure",
        state: "In Progress",
        parameter: {
          source: "Formula",
          formula: "= {p-supply} - {p-load}",
          unit: "W"
        }
      },
      {
        key: "req-margin",
        type: "Requirement",
        name: "Heater power margin stays positive",
        parentKey: "structure",
        state: "Todo",
        requirement: {
          category: "Design Constraint",
          operator: "≥",
          target: 0,
          unit: "W",
          verificationMethod: "Analysis",
          actualParameter: "p-margin"
        }
      },
      {
        // Phase 3: the qualification unit flies a tracker from the group.
        key: "task-tracker",
        type: "Task",
        name: "Fit a star tracker to the qualification unit",
        parentKey: "structure",
        state: "Todo",
        milestone: "qual-complete",
        estimatedHours: 6,
        materials: [{ item: "ST-050", quantity: 1, requiredOffset: 35 }]
      }
    ],
    links: [
      { from: "structure", to: "req-mass-budget", type: "satisfies" },
      { from: "tc-mass", to: "req-mass-budget", type: "verifies" },
      { from: "task-fem", to: "tc-sine", type: "precedes" }
    ]
  },
  {
    key: "cleanroom",
    name: "Integration Clean Room",
    description:
      "An ISO 7 clean room for satellite integration, built in house and capitalized",
    identifier: "ICR",
    costTreatment: "Capitalize",
    fixedAssetClass: "Construction in Progress",
    status: "Draft",
    milestones: [
      {
        key: "design",
        name: "Design Complete",
        startOffset: 5,
        endOffset: 35
      },
      {
        key: "certified",
        name: "Room Certified",
        startOffset: 36,
        endOffset: 120
      }
    ],
    elements: [
      {
        key: "room",
        type: "System",
        name: "ISO 7 clean room",
        state: "Todo",
        isFinalAsset: true,
        budget: 240000
      },
      {
        key: "req-class",
        type: "Requirement",
        name: "Meet ISO 14644-1 Class 7 at rest",
        parentKey: "room",
        state: "Todo",
        milestone: "certified"
      },
      {
        key: "task-hvac",
        type: "Task",
        name: "Specify the HEPA fan filter units",
        parentKey: "req-class",
        state: "Todo",
        milestone: "design",
        estimatedHours: 24
      },
      {
        key: "tc-particle",
        type: "Test Case",
        name: "Particle count certification",
        parentKey: "req-class",
        state: "Backlog",
        milestone: "certified",
        estimatedHours: 8
      },
      {
        key: "shell",
        type: "System",
        name: "Wall and ceiling panels",
        parentKey: "room",
        state: "Todo",
        budget: 90000
      },
      {
        key: "task-panels",
        type: "Task",
        name: "Order the modular wall panels",
        parentKey: "shell",
        state: "Backlog",
        milestone: "design",
        estimatedHours: 6
      },
      {
        key: "gowning",
        type: "System",
        name: "Gowning room",
        parentKey: "room",
        state: "Backlog",
        budget: 30000
      },
      {
        key: "task-layout",
        type: "Task",
        name: "Lay out the gowning room benches",
        parentKey: "gowning",
        state: "Backlog",
        estimatedHours: 4
      }
    ],
    links: [
      { from: "room", to: "req-class", type: "satisfies" },
      { from: "tc-particle", to: "req-class", type: "verifies" },
      { from: "task-panels", to: "task-layout", type: "precedes" }
    ]
  },
  {
    // Phase 3: the third member of the Star Tracker planning group.
    key: "polarview-pathfinder",
    name: "PolarView Imaging Pathfinder",
    description: "Two-satellite imaging pathfinder for PolarView Earth",
    identifier: "PVP",
    costTreatment: "Contract",
    status: "Released",
    milestones: [
      {
        key: "pdr",
        name: "Preliminary Design Review",
        startOffset: -30,
        endOffset: -2
      },
      {
        key: "integration",
        name: "Pathfinder Integration",
        startOffset: -1,
        endOffset: 90
      }
    ],
    elements: [
      {
        key: "adcs",
        type: "System",
        name: "Attitude determination and control",
        state: "In Progress",
        budget: 120000
      },
      {
        key: "req-knowledge",
        type: "Requirement",
        name: "Attitude knowledge within 2 arcseconds",
        parentKey: "adcs",
        state: "In Progress",
        milestone: "pdr"
      },
      {
        key: "task-trackers",
        type: "Task",
        name: "Fit one star tracker to each satellite",
        parentKey: "req-knowledge",
        state: "Todo",
        milestone: "integration",
        estimatedHours: 16,
        materials: [{ item: "ST-050", quantity: 2, requiredOffset: 45 }]
      },
      {
        key: "tc-sky",
        type: "Test Case",
        name: "Night-sky star tracker test",
        parentKey: "req-knowledge",
        state: "Backlog",
        milestone: "integration",
        estimatedHours: 8
      },
      {
        key: "imager",
        type: "System",
        name: "Imaging payload",
        state: "Todo",
        budget: 160000
      },
      {
        key: "req-gsd",
        type: "Requirement",
        name: "Ground sample distance under 3 m",
        parentKey: "imager",
        state: "Todo"
      },
      {
        key: "task-focus",
        type: "Task",
        name: "Focus the telescope in thermal vacuum",
        parentKey: "req-gsd",
        state: "Backlog",
        milestone: "integration",
        estimatedHours: 12
      },
      {
        key: "tc-mtf",
        type: "Test Case",
        name: "Modulation transfer function test",
        parentKey: "req-gsd",
        state: "Backlog",
        estimatedHours: 6
      }
    ],
    links: [
      { from: "tc-sky", to: "req-knowledge", type: "verifies" },
      { from: "tc-mtf", to: "req-gsd", type: "verifies" }
    ]
  }
];

/**
 * Projects Phase 3: three programs pool their star trackers. Earliest Need
 * pegs the 4 received trackers to OB2 (2), NSG3 (1) and PVP (1); the 2 on
 * order go to PVP's second tracker and OB2's pointing test spare.
 */
export const PLANNING_GROUPS: PlanningGroupSpec[] = [
  {
    name: "Star Tracker",
    priorityRule: "Earliest Need",
    members: [
      { project: "orbsec-block2", priority: 10 },
      { project: "polarview-pathfinder", priority: 20 },
      { project: "novasat-gen3", priority: 30 }
    ],
    item: "ST-050",
    received: {
      purchaseOrder: "po:st-group-received",
      pegs: [
        { project: "orbsec-block2", element: "task-alignment", quantity: 2 },
        { project: "novasat-gen3", element: "task-tracker", quantity: 1 },
        {
          project: "polarview-pathfinder",
          element: "task-trackers",
          quantity: 1
        }
      ]
    },
    open: {
      purchaseOrder: "po:st-group-open",
      pegs: [
        {
          project: "polarview-pathfinder",
          element: "task-trackers",
          quantity: 1
        },
        { project: "orbsec-block2", element: "tc-pointing", quantity: 1 }
      ]
    }
  }
];

/**
 * Government contracting Phase 5b: the A&D cost structure. Fringe on total
 * labor, overhead on direct labor and G&A on total cost input. Administrative
 * salaries are G&A cost and part of the fringe base, so the fringe on them
 * carries into G&A (decision B3). Burden and Actual rates come from the
 * period run, which the seed does not run.
 */
export const INDIRECT_POOLS: IndirectPoolSpec[] = [
  {
    name: "Fringe",
    poolType: "Fringe",
    sequence: 1,
    baseType: "Total Labor Dollars",
    appliedAccount: "5060",
    accounts: [
      { account: "6100", role: "Cost" },
      { account: "6060", role: "Base" }
    ],
    rate: 0.32
  },
  {
    name: "Overhead",
    poolType: "Overhead",
    sequence: 2,
    baseType: "Direct Labor Dollars",
    appliedAccount: "5070",
    accounts: [
      { account: "5050", role: "Cost" },
      { account: "6010", role: "Cost" }
    ],
    rate: 0.85
  },
  {
    name: "G&A",
    poolType: "G&A",
    sequence: 3,
    baseType: "Total Cost Input",
    appliedAccount: "5070",
    accounts: [
      { account: "6060", role: "Cost" },
      { account: "6070", role: "Cost" },
      { account: "6080", role: "Cost" }
    ],
    rate: 0.12
  }
];

export const LABOR_CATEGORIES: LaborCategorySpec[] = [
  {
    name: "Systems Engineer",
    description: "Owns requirements and system budgets",
    costRate: 92
  },
  {
    name: "Test Technician",
    description: "Runs environmental and functional tests",
    costRate: 58
  },
  {
    name: "Design Engineer",
    description: "Designs and analyses structures and subsystems",
    costRate: 85
  }
];

// Draft this week, Submitted last week: the timesheet and the approvals queue.
export const TIMESHEET_ENTRIES: TimesheetEntrySpec[] = [
  {
    project: "orbsec-block2",
    element: "task-mass",
    laborCategory: "Systems Engineer",
    week: -1,
    weekday: 0,
    hours: 6,
    status: "Submitted",
    note: "Harness mass update"
  },
  {
    project: "orbsec-block2",
    element: "task-array",
    laborCategory: "Design Engineer",
    week: -1,
    weekday: 1,
    hours: 4,
    status: "Submitted"
  },
  {
    project: "novasat-gen3",
    element: "task-fem",
    laborCategory: "Design Engineer",
    week: -1,
    weekday: 2,
    hours: 7.5,
    status: "Submitted"
  },
  {
    project: "novasat-gen3",
    element: "tc-sine",
    laborCategory: "Test Technician",
    week: -1,
    weekday: 3,
    hours: 5,
    status: "Submitted"
  },
  {
    project: "orbsec-block2",
    element: "task-mass",
    laborCategory: "Systems Engineer",
    week: 0,
    weekday: 0,
    hours: 4,
    status: "Draft"
  },
  {
    project: "orbsec-block2",
    element: "tc-power",
    laborCategory: "Test Technician",
    week: 0,
    weekday: 1,
    hours: 3,
    status: "Draft"
  },
  {
    project: "novasat-gen3",
    element: "task-fem",
    laborCategory: "Design Engineer",
    week: 0,
    weekday: 0,
    hours: 6,
    status: "Draft"
  },
  {
    project: "novasat-gen3",
    element: "tc-modal",
    laborCategory: "Test Technician",
    week: 0,
    weekday: 2,
    hours: 2,
    status: "Draft"
  }
];

export const CLOSE_TASKS: PeriodCloseTaskSpec[] = [
  { definition: "Post pending operational documents", status: "Done" },
  {
    definition: "Review negative on-hand inventory",
    status: "Skipped",
    skippedReason: "Cycle count reconciled every bin at month end"
  },
  {
    definition: "Review financial statements",
    status: "Open",
    notes: "Controller to review program margin on the ORBSEC contract"
  }
];

export const satelliteAccounting: AccountingData = {
  fixedAssets: FIXED_ASSETS,
  journalEntries: JOURNAL_ENTRIES,
  payments: PAYMENTS,
  memos: MEMOS,
  projects: PROJECTS,
  planningGroups: PLANNING_GROUPS,
  indirectPools: INDIRECT_POOLS,
  laborCategories: LABOR_CATEGORIES,
  timesheetEntries: TIMESHEET_ENTRIES,
  customDimension: {
    name: "Mission Phase",
    values: ["Design & Qualification", "Integration & Test"]
  },
  closeTasks: CLOSE_TASKS,
  // EUR per 1 USD (foreign units per base unit), the same direction as the EUR purchase order's 0.92 snapshot.
  exchangeRateOverrides: [{ currencyCode: "EUR", rate: 0.9215 }],
  billingAddresses: {
    receivable: {
      addressLine1: "4500 Space Commerce Drive",
      city: "Houston",
      state: "TX",
      postalCode: "77058",
      countryCode: "US",
      phone: "+1-281-555-1140",
      email: "ar@orbitalsystems.example"
    },
    payable: {
      addressLine1: "4500 Space Commerce Drive",
      city: "Houston",
      state: "TX",
      postalCode: "77058",
      countryCode: "US",
      phone: "+1-281-555-1150",
      email: "ap@orbitalsystems.example"
    }
  }
};
