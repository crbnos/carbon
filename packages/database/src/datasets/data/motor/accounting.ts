// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  AccountingData,
  FixedAssetSpec,
  JournalEntrySpec,
  LaborCategorySpec,
  MemoSpec,
  PaymentSpec,
  PeriodCloseTaskSpec,
  ProjectSpec,
  TimesheetEntrySpec
} from "../../types.ts";

export const FIXED_ASSETS: FixedAssetSpec[] = [
  {
    key: "oven",
    className: "Buildings",
    location: "Plant",
    name: "Impregnation Oven Bay & Extraction Plant",
    description:
      "Varnish oven bay with solvent extraction serving the winding line",
    serialNumber: "OVN-BAY-77103",
    status: "Active",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    acquisitionCost: 120000,
    acquisitionOffset: -941,
    depreciationStartOffset: -910,
    accumulatedDepreciation: 0,
    // 114,000 / 120 = 950 per month x the 30 months from the depreciation start
    // to the run's period end
    depreciationCharge: 28500
  },
  {
    key: "dyno",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Motor Dynamometer Test Stand",
    description:
      "Regenerative dyno used for acceptance testing every finished motor",
    serialNumber: "DYN-4Q-00812",
    status: "Active",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    acquisitionCost: 288000,
    acquisitionOffset: -521,
    depreciationStartOffset: -485,
    accumulatedDepreciation: 0,
    // 273,600 / 120 = 2,280 per month x the 16 months from the depreciation
    // start to the run's period end
    depreciationCharge: 36480
  },
  {
    key: "winder",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Automatic Coil Winding Machine",
    description: "Awaiting registration — acquisition cost booked on register",
    serialNumber: "WND-AX8-20551",
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
    name: "Field Service Van",
    description: "Cargo van for customer site swaps and supplier pickups",
    serialNumber: "VIN-1FTBW2CM4LKB33127",
    status: "Fully Depreciated",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 60,
    residualValuePercent: 0,
    acquisitionCost: 52000,
    acquisitionOffset: -2617,
    depreciationStartOffset: -2586,
    accumulatedDepreciation: 52000
  },
  {
    key: "winder-gen1",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Coil Winding Machine (Gen 1)",
    description:
      "First-generation coil winder replaced by the automatic winder; sold to a rewind shop",
    serialNumber: "CW-G1-20944",
    status: "Disposed",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 0,
    acquisitionCost: 72000,
    acquisitionOffset: -3100,
    depreciationStartOffset: -3080,
    // 72,000 / 120 = 600 per month x the 100 months depreciated before sale.
    // NBV 12,000 against 9,000 proceeds books a 3,000 loss.
    accumulatedDepreciation: 60000,
    disposal: { dateOffset: -40, method: "Sale", saleProceeds: 9000 }
  },
  {
    key: "balancer",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Rotor Balancing Machine",
    description: "Dynamic rotor balancer, depreciated by balancing cycles",
    serialNumber: "RBM-2P-61507",
    status: "Active",
    depreciationMethod: "Units of Production",
    usefulLifeMonths: 96,
    residualValuePercent: 0,
    acquisitionCost: 84000,
    acquisitionOffset: -120,
    depreciationStartOffset: -100,
    // 84,000 / 420,000 cycles = 0.20 per cycle. The first logged month (3,800)
    // was booked on registration; the run's month (4,100) is the charge.
    assetLifetimeUsage: 420000,
    accumulatedDepreciation: 760,
    usageLogs: [
      { monthsBack: 2, unitsProduced: 3800 },
      { monthsBack: 1, unitsProduced: 4100 }
    ],
    depreciationCharge: 820
  }
];

export const JOURNAL_ENTRIES: JournalEntrySpec[] = [
  {
    ref: "journal:revenue",
    journalEntryId: "JE-SEED-001",
    description: "Revenue recognition — Ridgeline partial delivery",
    status: "Draft",
    postingOffset: -256,
    lines: [
      {
        accountClass: "Asset",
        description: "Ridgeline conveyor drive milestone",
        amount: 28200,
        quantity: 6,
        journalLineReference: "JE-SEED-001"
      },
      {
        // Positive on a Revenue account IS the credit — the journalEntries view
        // derives debit/credit from account class AND sign, so a negative here
        // reads as a second debit and the entry blocks period close.
        accountClass: "Revenue",
        description: "Ridgeline conveyor drive milestone",
        amount: 28200,
        quantity: 6,
        journalLineReference: "JE-SEED-001"
      }
    ]
  },
  {
    ref: "journal:payroll-accrual",
    journalEntryId: "JE-SEED-002",
    description: "Payroll accrual — winding and assembly crew, final week",
    status: "Posted",
    postingOffset: -12,
    lines: [
      {
        account: "6060",
        description: "Accrued winding and assembly wages",
        amount: 29400,
        quantity: 1,
        journalLineReference: "JE-SEED-002-1",
        dimensions: [
          { dimension: "Project", value: "ridgeline-traction" },
          { dimension: "Motor Family", value: "Traction Motors" }
        ]
      },
      {
        account: "2150",
        description: "Accrued winding and assembly wages",
        amount: 29400,
        quantity: 1,
        journalLineReference: "JE-SEED-002-2"
      }
    ]
  },
  {
    ref: "journal:amortization",
    journalEntryId: "JE-SEED-003",
    description: "Monthly amortization — winding pattern design license",
    status: "Posted",
    postingOffset: -23,
    lines: [
      {
        account: "6310",
        description: "Winding pattern design license amortization",
        amount: 720,
        quantity: 1,
        journalLineReference: "JE-SEED-003"
      },
      {
        // A credit on the contra-asset: negative on a debit-normal class.
        account: "1420",
        description: "Winding pattern design license amortization",
        amount: -720,
        quantity: 1,
        journalLineReference: "JE-SEED-003"
      }
    ]
  },
  {
    ref: "journal:freight-accrual",
    journalEntryId: "JE-SEED-004",
    description: "Accrued outbound freight — duplicate of carrier invoice",
    status: "Reversed",
    postingOffset: -40,
    lines: [
      {
        account: "6040",
        description: "Outbound LTL freight",
        amount: 2860,
        quantity: 1,
        journalLineReference: "JE-SEED-004"
      },
      {
        account: "2140",
        description: "Outbound LTL freight",
        amount: 2860,
        quantity: 1,
        journalLineReference: "JE-SEED-004"
      }
    ],
    reversal: {
      ref: "journal:freight-accrual-reversal",
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
        amount: 610000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-1"
      },
      {
        account: "1210",
        description: "Raw materials on hand",
        amount: 180000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-2"
      },
      {
        account: "1220",
        description: "Finished goods on hand",
        amount: 140000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-3"
      },
      {
        account: "1350",
        description: "Machinery & equipment at cost",
        amount: 1120000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-4"
      },
      {
        account: "1330",
        description: "Accumulated depreciation to date",
        amount: -290000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-5"
      },
      {
        account: "2410",
        description: "Equipment term loan",
        amount: 650000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-6"
      },
      {
        account: "3010",
        description: "Paid-in capital",
        amount: 600000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-7"
      },
      {
        account: "3100",
        description: "Retained earnings brought forward",
        amount: 510000,
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
    key: "wabash-ach",
    type: "Receipt",
    customer: "Wabash Industrial Supply",
    dateOffset: -45,
    amount: 300,
    reference: "ACH 9021-3345",
    applies: [{ invoiceKey: "paid", amount: 300 }]
  },
  {
    key: "ridgeline-wire",
    type: "Receipt",
    customer: "Ridgeline Drive Systems",
    dateOffset: -10,
    amount: 710,
    reference: "WIRE 61188",
    applies: [{ invoiceKey: "partial", amount: 710 }]
  },
  {
    key: "cardinal-credit",
    type: "Receipt",
    customer: "Cardinal Motorworks",
    dateOffset: -49,
    amount: 0,
    reference: "Credit application",
    applies: [],
    credits: [{ memoKey: "cardinal-shafts", invoiceKey: "credit", amount: 410 }]
  },
  {
    key: "copperline-ach",
    type: "Disbursement",
    supplier: "Copperline Wire Works",
    dateOffset: -31,
    amount: 1036,
    reference: "ACH 2217-8806",
    applies: [{ invoiceKey: "paid", amount: 1036 }]
  },
  {
    key: "copperline-check",
    type: "Disbursement",
    supplier: "Copperline Wire Works",
    dateOffset: -12,
    amount: 178,
    reference: "CHK 41209",
    applies: [{ invoiceKey: "partial", amount: 178 }]
  },
  {
    key: "lakeland-debit",
    type: "Disbursement",
    supplier: "Lakeland Electrical Steel",
    dateOffset: -66,
    amount: 0,
    reference: "Debit application",
    applies: [],
    credits: [
      { memoKey: "lakeland-bar", invoiceKey: "debit-note", amount: 975 }
    ]
  },
  {
    key: "draft-receipt",
    type: "Receipt",
    status: "Draft",
    customer: "Cardinal Motorworks",
    dateOffset: -1,
    amount: 780,
    reference: "ACH advice 5580 — 4500 stator",
    applies: []
  },
  {
    key: "draft-disbursement",
    type: "Disbursement",
    status: "Draft",
    supplier: "Lakeland Electrical Steel",
    dateOffset: 0,
    amount: 540,
    reference: "ACH batch 0930 — lamination steel",
    applies: []
  }
];

export const MEMOS: MemoSpec[] = [
  {
    key: "cardinal-shafts",
    direction: "Credit",
    customer: "Cardinal Motorworks",
    invoiceKey: "credit",
    dateOffset: -52,
    amount: 410,
    notes:
      "Full credit — precision shafts returned with bearing-seat runout out of tolerance"
  },
  {
    key: "lakeland-bar",
    direction: "Debit",
    supplier: "Lakeland Electrical Steel",
    invoiceKey: "debit-note",
    dateOffset: -70,
    amount: 975,
    notes: "Bar stock failed the mill-cert review at Lakeland — billing debited"
  }
];

export const PROJECTS: ProjectSpec[] = [
  {
    key: "ridgeline-traction",
    name: "Ridgeline EV Traction Motor Launch",
    description:
      "Production launch of the 9000-series traction motor for Ridgeline",
    identifier: "RTM",
    costTreatment: "Contract",
    status: "Released",
    // Phase 2a: the contract keeps its own stock — two parts received for
    // it, and fasteners transferred in from common stock.
    projectStock: {
      openingStock: [
        {
          item: "FST-M10-SS",
          shelf: "A1-L1",
          qty: 100,
          unitCost: 1.15,
          dateOffset: -30
        },
        {
          item: "TRM-BLK-6P",
          shelf: "A1-L2",
          qty: 10,
          unitCost: 8.9,
          dateOffset: -30
        }
      ],
      transfers: [
        {
          item: "FST-M6-SS",
          shelf: "A1-L1",
          qty: 50,
          reason: "Kit the contract motors' frame fasteners",
          dateOffset: -12
        }
      ]
    },
    purchaseInvoiceLine: { invoiceKey: "paid", item: "MAT-CU-18AWG" },
    milestones: [
      { key: "pilot", name: "Pilot Build", startOffset: -55, endOffset: -7 },
      {
        key: "sop",
        name: "Start of Production",
        startOffset: -6,
        endOffset: 55
      }
    ],
    elements: [
      {
        key: "motor",
        type: "System",
        name: "9000-series traction motor",
        state: "In Progress",
        budget: 210000
      },
      {
        key: "req-efficiency",
        type: "Requirement",
        name: "Peak efficiency above 95 percent",
        parentKey: "motor",
        state: "In Progress",
        milestone: "pilot"
      },
      {
        key: "task-winding",
        type: "Task",
        name: "Tune the hairpin winding pattern",
        parentKey: "req-efficiency",
        state: "Done",
        milestone: "pilot",
        estimatedHours: 28
      },
      {
        key: "tc-dyno",
        type: "Test Case",
        name: "Efficiency map on the dyno",
        parentKey: "req-efficiency",
        state: "In Review",
        milestone: "pilot",
        estimatedHours: 12
      },
      {
        key: "req-noise",
        type: "Requirement",
        name: "Noise under 75 dBA at 10,000 rpm",
        parentKey: "motor",
        state: "Todo",
        milestone: "sop"
      },
      {
        key: "task-skew",
        type: "Task",
        name: "Add rotor skew to cut torque ripple",
        parentKey: "req-noise",
        state: "In Progress",
        milestone: "sop",
        estimatedHours: 20
      },
      {
        key: "tc-noise",
        type: "Test Case",
        name: "NVH test in the semi-anechoic room",
        parentKey: "req-noise",
        state: "Todo",
        milestone: "sop",
        estimatedHours: 8
      },
      {
        key: "line",
        type: "System",
        name: "Assembly line",
        state: "Todo",
        milestone: "sop",
        budget: 90000
      },
      {
        key: "req-takt",
        type: "Requirement",
        name: "Build one motor every 90 seconds",
        parentKey: "line",
        state: "Backlog",
        milestone: "sop"
      },
      {
        key: "task-press",
        type: "Task",
        name: "Specify the stator press-fit station",
        parentKey: "req-takt",
        state: "Backlog",
        estimatedHours: 16
      }
    ]
  },
  {
    key: "dyno-automation",
    name: "Dyno Cell Automation",
    description:
      "Automated load profiles and data capture for end-of-line testing",
    identifier: "DCA",
    costTreatment: "Expense",
    status: "Released",
    milestones: [
      {
        key: "profiles",
        name: "Load Profiles Defined",
        startOffset: -30,
        endOffset: -2
      },
      { key: "go-live", name: "Go-Live", startOffset: -1, endOffset: 45 }
    ],
    elements: [
      {
        key: "cell",
        type: "System",
        name: "End-of-line dyno cell",
        item: "MTR-4500",
        state: "In Progress",
        budget: 75000
      },
      {
        key: "req-profile",
        type: "Requirement",
        name: "Run the customer load profile automatically",
        parentKey: "cell",
        state: "In Progress",
        milestone: "profiles"
      },
      {
        key: "task-script",
        type: "Task",
        name: "Script the load profile in the test executive",
        parentKey: "req-profile",
        state: "In Progress",
        milestone: "go-live",
        estimatedHours: 24
      },
      {
        key: "tc-profile",
        type: "Test Case",
        name: "Run the profile on five production motors",
        parentKey: "req-profile",
        state: "Todo",
        milestone: "go-live",
        estimatedHours: 6
      },
      {
        key: "req-data",
        type: "Requirement",
        name: "Store every test result against the serial number",
        parentKey: "cell",
        state: "Done",
        milestone: "profiles"
      },
      {
        key: "task-db",
        type: "Task",
        name: "Map the test results to the serial number",
        parentKey: "req-data",
        state: "Done",
        milestone: "profiles",
        estimatedHours: 10
      },
      {
        key: "tc-data",
        type: "Test Case",
        name: "Trace ten serial numbers to their results",
        parentKey: "req-data",
        state: "Todo",
        milestone: "go-live",
        estimatedHours: 3
      },
      {
        key: "safety",
        type: "System",
        name: "Cell safety",
        state: "Backlog",
        budget: 20000
      },
      {
        key: "req-guard",
        type: "Requirement",
        name: "Interlock the dyno guard door",
        parentKey: "safety",
        state: "Backlog"
      },
      {
        key: "task-guard",
        type: "Task",
        name: "Wire the guard door interlock",
        parentKey: "req-guard",
        state: "Backlog",
        estimatedHours: 6
      },
      {
        key: "p-mass",
        type: "Parameter",
        name: "Test cycle time",
        parentKey: "cell",
        state: "In Progress",
        parameter: { source: "Sum", unit: "s" }
      },
      {
        key: "p-mass-a",
        type: "Parameter",
        name: "Load step time",
        parentKey: "p-mass",
        state: "In Progress",
        parameter: { source: "Manual", value: 45, unit: "s" }
      },
      {
        key: "p-mass-b",
        type: "Parameter",
        name: "Measurement time",
        parentKey: "p-mass",
        state: "In Progress",
        parameter: { source: "Manual", value: 30, unit: "s" }
      },
      {
        key: "req-mass-budget",
        type: "Requirement",
        name: "Test cycle at most 90 s",
        parentKey: "cell",
        state: "In Review",
        requirement: {
          category: "Performance",
          operator: "≤",
          target: 90,
          unit: "s",
          verificationMethod: "Test",
          actualParameter: "p-mass"
        }
      },
      {
        key: "tc-mass",
        type: "Test Case",
        name: "Time a full test profile",
        parentKey: "req-mass-budget",
        state: "Done",
        verdict: "Pass"
      },
      {
        key: "p-supply",
        type: "Parameter",
        name: "Absorber capacity",
        parentKey: "cell",
        state: "In Progress",
        parameter: { source: "Manual", value: 55, unit: "kW" }
      },
      {
        key: "p-load",
        type: "Parameter",
        name: "Motor test load",
        parentKey: "cell",
        state: "In Progress",
        parameter: { source: "Manual", value: 45, unit: "kW" }
      },
      {
        key: "p-margin",
        type: "Parameter",
        name: "Absorber margin",
        parentKey: "cell",
        state: "In Progress",
        parameter: {
          source: "Formula",
          formula: "= {p-supply} - {p-load}",
          unit: "kW"
        }
      },
      {
        key: "req-margin",
        type: "Requirement",
        name: "Absorber margin stays positive",
        parentKey: "cell",
        state: "Todo",
        requirement: {
          category: "Design Constraint",
          operator: "≥",
          target: 0,
          unit: "kW",
          verificationMethod: "Analysis",
          actualParameter: "p-margin"
        }
      }
    ],
    links: [
      { from: "cell", to: "req-mass-budget", type: "satisfies" },
      { from: "tc-mass", to: "req-mass-budget", type: "verifies" },
      { from: "task-script", to: "tc-profile", type: "precedes" }
    ]
  }
];

export const LABOR_CATEGORIES: LaborCategorySpec[] = [
  {
    name: "Electrical Engineer",
    description: "Designs motors and drives",
    costRate: 90
  },
  {
    name: "Test Technician",
    description: "Runs dyno and end-of-line tests",
    costRate: 56
  },
  {
    name: "Process Engineer",
    description: "Plans assembly and test processes",
    costRate: 80
  }
];

// Draft this week, Submitted last week: the timesheet and the approvals queue.
export const TIMESHEET_ENTRIES: TimesheetEntrySpec[] = [
  {
    project: "ridgeline-traction",
    element: "task-skew",
    laborCategory: "Electrical Engineer",
    week: -1,
    weekday: 0,
    hours: 6,
    status: "Submitted",
    note: "Rotor skew study"
  },
  {
    project: "ridgeline-traction",
    element: "tc-dyno",
    laborCategory: "Test Technician",
    week: -1,
    weekday: 1,
    hours: 5,
    status: "Submitted"
  },
  {
    project: "dyno-automation",
    element: "task-script",
    laborCategory: "Process Engineer",
    week: -1,
    weekday: 2,
    hours: 7,
    status: "Submitted"
  },
  {
    project: "dyno-automation",
    element: "task-db",
    laborCategory: "Process Engineer",
    week: -1,
    weekday: 3,
    hours: 3,
    status: "Submitted"
  },
  {
    project: "ridgeline-traction",
    element: "task-skew",
    laborCategory: "Electrical Engineer",
    week: 0,
    weekday: 0,
    hours: 5,
    status: "Draft"
  },
  {
    project: "ridgeline-traction",
    element: "tc-noise",
    laborCategory: "Test Technician",
    week: 0,
    weekday: 1,
    hours: 2,
    status: "Draft"
  },
  {
    project: "dyno-automation",
    element: "task-script",
    laborCategory: "Process Engineer",
    week: 0,
    weekday: 0,
    hours: 6,
    status: "Draft"
  },
  {
    project: "dyno-automation",
    element: "tc-profile",
    laborCategory: "Test Technician",
    week: 0,
    weekday: 2,
    hours: 3,
    status: "Draft"
  }
];

export const CLOSE_TASKS: PeriodCloseTaskSpec[] = [
  { definition: "Post pending operational documents", status: "Done" },
  {
    definition: "Review negative on-hand inventory",
    status: "Skipped",
    skippedReason: "Physical count at month end found no negative bins"
  },
  {
    definition: "Review financial statements",
    status: "Open",
    notes: "Plant controller to review absorption variance"
  }
];

export const motorAccounting: AccountingData = {
  fixedAssets: FIXED_ASSETS,
  journalEntries: JOURNAL_ENTRIES,
  payments: PAYMENTS,
  memos: MEMOS,
  projects: PROJECTS,
  indirectPools: [],
  laborCategories: LABOR_CATEGORIES,
  timesheetEntries: TIMESHEET_ENTRIES,
  customDimension: {
    name: "Motor Family",
    values: ["Traction Motors", "Industrial Servo"]
  },
  closeTasks: CLOSE_TASKS,
  // EUR per 1 USD (foreign units per base unit), the same direction as the EUR purchase order's 0.92 snapshot.
  exchangeRateOverrides: [{ currencyCode: "EUR", rate: 0.9215 }],
  billingAddresses: {
    receivable: {
      addressLine1: "1450 Meyer Industrial Road",
      city: "Fort Wayne",
      state: "IN",
      postalCode: "46803",
      countryCode: "US",
      phone: "+1-260-555-0174",
      email: "ar@torquedynamics.example"
    },
    payable: {
      addressLine1: "1450 Meyer Industrial Road",
      city: "Fort Wayne",
      state: "IN",
      postalCode: "46803",
      countryCode: "US",
      phone: "+1-260-555-0175",
      email: "ap@torquedynamics.example"
    }
  }
};
