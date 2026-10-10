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
    key: "hvac",
    className: "Buildings",
    location: "Plant",
    name: "Assembly Bay Air Handling & Filtration",
    description: "Filtered air handling plant serving the integration cells",
    serialNumber: "AHU-IC1-88421",
    status: "Active",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    acquisitionCost: 96000,
    acquisitionOffset: -941,
    depreciationStartOffset: -910,
    accumulatedDepreciation: 0,
    // 91,200 / 120 = 760 per month x the 30 months from the depreciation start
    // to the run's period end
    depreciationCharge: 22800
  },
  {
    key: "cmm",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Coordinate Measuring Machine",
    description: "Bridge-type CMM used for first article inspection of links",
    serialNumber: "CMM-BR12-00317",
    status: "Active",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    acquisitionCost: 216000,
    acquisitionOffset: -521,
    depreciationStartOffset: -485,
    accumulatedDepreciation: 0,
    // 205,200 / 120 = 1,710 per month x the 16 months from the depreciation
    // start to the run's period end
    depreciationCharge: 27360
  },
  {
    key: "cnc",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "5-Axis CNC Machining Center",
    description: "Awaiting registration — acquisition cost booked on register",
    serialNumber: "CNC-5X-41208",
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
    description: "Cargo van for customer site installs and supplier pickups",
    serialNumber: "VIN-1FTBW2CM7KKA10293",
    status: "Fully Depreciated",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 60,
    residualValuePercent: 0,
    acquisitionCost: 46000,
    acquisitionOffset: -2617,
    depreciationStartOffset: -2586,
    accumulatedDepreciation: 46000
  },
  {
    key: "wave-solder",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Legacy Wave-Solder Machine",
    description:
      "Through-hole wave solder line retired after the move to selective soldering; sold to a contract assembler",
    serialNumber: "WS-350-11820",
    status: "Disposed",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 80,
    residualValuePercent: 0,
    acquisitionCost: 64000,
    acquisitionOffset: -2200,
    depreciationStartOffset: -2150,
    // 64,000 / 80 = 800 per month x the 70 months depreciated before sale.
    // NBV 8,000 against 6,500 proceeds books a 1,500 loss.
    accumulatedDepreciation: 56000,
    disposal: { dateOffset: -25, method: "Sale", saleProceeds: 6500 }
  },
  {
    key: "servo-press",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Servo Press Station",
    description:
      "Gripper sub-assembly servo press, depreciated by press cycles",
    serialNumber: "SPS-40-55120",
    status: "Active",
    depreciationMethod: "Units of Production",
    usefulLifeMonths: 96,
    residualValuePercent: 0,
    acquisitionCost: 150000,
    acquisitionOffset: -120,
    depreciationStartOffset: -100,
    // 150,000 / 2,500,000 cycles = 0.06 per cycle. The first logged month (18,000)
    // was booked on registration; the run's month (22,500) is the charge.
    assetLifetimeUsage: 2500000,
    accumulatedDepreciation: 1080,
    usageLogs: [
      { monthsBack: 2, unitsProduced: 18000 },
      { monthsBack: 1, unitsProduced: 22500 }
    ],
    depreciationCharge: 1350
  }
];

export const JOURNAL_ENTRIES: JournalEntrySpec[] = [
  {
    ref: "journal:revenue",
    journalEntryId: "JE-SEED-001",
    description: "Revenue recognition — Lakeshore partial delivery",
    status: "Draft",
    postingOffset: -256,
    lines: [
      {
        accountClass: "Asset",
        description: "Lakeshore weld cell milestone",
        amount: 54000,
        quantity: 1,
        journalLineReference: "JE-SEED-001"
      },
      {
        // Positive on a Revenue account IS the credit — the journalEntries view
        // derives debit/credit from account class AND sign, so a negative here
        // reads as a second debit and the entry blocks period close.
        accountClass: "Revenue",
        description: "Lakeshore weld cell milestone",
        amount: 54000,
        quantity: 1,
        journalLineReference: "JE-SEED-001"
      }
    ]
  },
  {
    ref: "journal:payroll-accrual",
    journalEntryId: "JE-SEED-002",
    description: "Payroll accrual — controls engineering, final week",
    status: "Posted",
    postingOffset: -12,
    lines: [
      {
        account: "6060",
        description: "Accrued controls engineering wages",
        amount: 36200,
        quantity: 1,
        journalLineReference: "JE-SEED-002-1",
        dimensions: [
          { dimension: "Project", value: "lakeshore-cell" },
          { dimension: "Product Line", value: "Collaborative Arms" }
        ]
      },
      {
        account: "2150",
        description: "Accrued controls engineering wages",
        amount: 36200,
        quantity: 1,
        journalLineReference: "JE-SEED-002-2"
      }
    ]
  },
  {
    ref: "journal:amortization",
    journalEntryId: "JE-SEED-003",
    description: "Monthly amortization — motion-control firmware license",
    status: "Posted",
    postingOffset: -23,
    lines: [
      {
        account: "6310",
        description: "Motion-control firmware license amortization",
        amount: 850,
        quantity: 1,
        journalLineReference: "JE-SEED-003"
      },
      {
        // A credit on the contra-asset: negative on a debit-normal class.
        account: "1420",
        description: "Motion-control firmware license amortization",
        amount: -850,
        quantity: 1,
        journalLineReference: "JE-SEED-003"
      }
    ]
  },
  {
    ref: "journal:tradeshow-accrual",
    journalEntryId: "JE-SEED-004",
    description: "Accrued trade-show booth — booked twice",
    status: "Reversed",
    postingOffset: -40,
    lines: [
      {
        account: "6030",
        description: "Automation expo booth",
        amount: 7400,
        quantity: 1,
        journalLineReference: "JE-SEED-004"
      },
      {
        account: "2140",
        description: "Automation expo booth",
        amount: 7400,
        quantity: 1,
        journalLineReference: "JE-SEED-004"
      }
    ],
    reversal: {
      ref: "journal:tradeshow-accrual-reversal",
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
        amount: 850000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-1"
      },
      {
        account: "1210",
        description: "Raw materials on hand",
        amount: 210000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-2"
      },
      {
        account: "1220",
        description: "Finished goods on hand",
        amount: 160000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-3"
      },
      {
        account: "1350",
        description: "Machinery & equipment at cost",
        amount: 940000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-4"
      },
      {
        account: "1330",
        description: "Accumulated depreciation to date",
        amount: -230000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-5"
      },
      {
        account: "2410",
        description: "Equipment term loan",
        amount: 600000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-6"
      },
      {
        account: "3010",
        description: "Paid-in capital",
        amount: 750000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-7"
      },
      {
        account: "3100",
        description: "Retained earnings brought forward",
        amount: 580000,
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
    key: "lakeshore-ach",
    type: "Receipt",
    customer: "Lakeshore Automotive",
    dateOffset: -46,
    amount: 700,
    reference: "ACH 5530-1187",
    applies: [{ invoiceKey: "paid", amount: 700 }]
  },
  {
    key: "alpine-wire",
    type: "Receipt",
    customer: "Alpine Research Institute",
    dateOffset: -15,
    amount: 2040,
    reference: "WIRE 40917 — grant drawdown",
    applies: [{ invoiceKey: "partial", amount: 2040 }]
  },
  {
    key: "cascade-credit",
    type: "Receipt",
    customer: "Cascade Integration Group",
    dateOffset: -49,
    amount: 0,
    reference: "Credit application",
    applies: [],
    credits: [{ memoKey: "cascade-jaws", invoiceKey: "credit", amount: 600 }]
  },
  {
    key: "northgate-ach",
    type: "Disbursement",
    supplier: "Northgate Electronics",
    dateOffset: -34,
    amount: 1858,
    reference: "ACH 7712-0093",
    applies: [{ invoiceKey: "paid", amount: 1858 }]
  },
  {
    key: "kestrel-check",
    type: "Disbursement",
    supplier: "Kestrel Motion",
    dateOffset: -11,
    amount: 2300,
    reference: "CHK 20318",
    applies: [{ invoiceKey: "partial", amount: 2300 }]
  },
  {
    key: "torqline-debit",
    type: "Disbursement",
    supplier: "Torqline Gearing",
    dateOffset: -65,
    amount: 0,
    reference: "Debit application",
    applies: [],
    credits: [
      { memoKey: "torqline-gears", invoiceKey: "debit-note", amount: 2300 }
    ]
  },
  {
    key: "draft-receipt",
    type: "Receipt",
    status: "Draft",
    customer: "Cascade Integration Group",
    dateOffset: -1,
    amount: 465,
    reference: "ACH advice 2217 — servo motor",
    applies: []
  },
  {
    key: "draft-disbursement",
    type: "Disbursement",
    status: "Draft",
    supplier: "Ironbark Metals",
    dateOffset: 0,
    amount: 195,
    reference: "ACH batch 0930 — billet",
    applies: []
  }
];

export const MEMOS: MemoSpec[] = [
  {
    key: "cascade-jaws",
    direction: "Credit",
    customer: "Cascade Integration Group",
    invoiceKey: "credit",
    dateOffset: -52,
    amount: 600,
    notes:
      "Full credit — gripper jaw sets returned with out-of-tolerance finger pitch"
  },
  {
    key: "torqline-gears",
    direction: "Debit",
    supplier: "Torqline Gearing",
    invoiceKey: "debit-note",
    dateOffset: -70,
    amount: 2300,
    notes:
      "Both received gear sets failed the outgoing backlash audit — billing debited"
  }
];

export const PROJECTS: ProjectSpec[] = [
  {
    key: "lakeshore-cell",
    name: "Lakeshore Weld Cell Retrofit",
    description:
      "Six-axis weld cell retrofit for Lakeshore Automotive's body shop",
    identifier: "LWC",
    costTreatment: "Contract",
    status: "Released",
    // Phase 2a: the contract keeps its own stock — two parts received for
    // it, and fasteners transferred in from common stock.
    projectStock: {
      openingStock: [
        {
          item: "FST-M5-SS",
          shelf: "A1-L1",
          qty: 100,
          unitCost: 0.55,
          dateOffset: -30
        },
        {
          item: "MAT-CONN-M23",
          shelf: "A1-L2",
          qty: 10,
          unitCost: 38,
          dateOffset: -30
        }
      ],
      transfers: [
        {
          item: "FST-M8-SS",
          shelf: "A1-L1",
          qty: 50,
          reason: "Kit the contract cells' base fasteners",
          dateOffset: -12
        }
      ]
    },
    purchaseInvoiceLine: { invoiceKey: "paid", item: "ENC-ABS-19" },
    milestones: [
      {
        key: "fat",
        name: "Factory Acceptance Test",
        startOffset: -50,
        endOffset: -8
      },
      {
        key: "sat",
        name: "Site Acceptance Test",
        startOffset: -7,
        endOffset: 40
      }
    ],
    elements: [
      {
        key: "cell",
        type: "System",
        name: "Weld cell",
        state: "In Progress",
        budget: 150000
      },
      {
        key: "req-cycle",
        type: "Requirement",
        name: "Weld cycle under 48 seconds per body side",
        parentKey: "cell",
        state: "In Progress",
        milestone: "fat"
      },
      {
        key: "task-path",
        type: "Task",
        name: "Optimize the robot weld path for the B-pillar",
        parentKey: "req-cycle",
        state: "Done",
        milestone: "fat",
        estimatedHours: 30
      },
      {
        key: "tc-cycle",
        type: "Test Case",
        name: "Cycle time run on 20 consecutive parts",
        parentKey: "req-cycle",
        state: "In Review",
        milestone: "fat",
        estimatedHours: 8
      },
      {
        key: "req-safety",
        type: "Requirement",
        name: "Light curtain stops the arm within 200 ms",
        parentKey: "cell",
        state: "Todo",
        milestone: "sat"
      },
      {
        key: "task-safety",
        type: "Task",
        name: "Wire the light curtain to the safety controller",
        parentKey: "req-safety",
        state: "In Progress",
        milestone: "sat",
        estimatedHours: 16
      },
      {
        key: "tc-safety",
        type: "Test Case",
        name: "Stop-time test at full speed",
        parentKey: "req-safety",
        state: "Todo",
        milestone: "sat",
        estimatedHours: 6
      },
      {
        key: "fixtures",
        type: "System",
        name: "Part fixtures",
        state: "Todo",
        milestone: "sat",
        budget: 60000
      },
      {
        key: "req-locate",
        type: "Requirement",
        name: "Locate the body side within 0.5 mm",
        parentKey: "fixtures",
        state: "Backlog"
      },
      {
        key: "task-clamp",
        type: "Task",
        name: "Design the pneumatic clamp layout",
        parentKey: "req-locate",
        state: "Backlog",
        estimatedHours: 20
      }
    ]
  },
  {
    key: "cobot-gen2",
    name: "Cobot Arm Gen-2 Development",
    description:
      "Next-generation collaborative arm with integrated torque sensing",
    identifier: "CG2",
    costTreatment: "Expense",
    status: "Released",
    milestones: [
      {
        key: "alpha",
        name: "Alpha Prototype",
        startOffset: -40,
        endOffset: -3
      },
      { key: "beta", name: "Beta Build", startOffset: -2, endOffset: 70 }
    ],
    elements: [
      {
        key: "arm",
        type: "System",
        name: "Gen-2 arm",
        item: "ARM-BASE-001",
        state: "In Progress",
        budget: 140000
      },
      {
        key: "req-torque",
        type: "Requirement",
        name: "Detect a 50 N contact in every joint",
        parentKey: "arm",
        state: "In Progress",
        milestone: "alpha"
      },
      {
        key: "task-sensor",
        type: "Task",
        name: "Integrate the joint torque sensor",
        parentKey: "req-torque",
        state: "In Progress",
        milestone: "beta",
        estimatedHours: 36
      },
      {
        key: "tc-contact",
        type: "Test Case",
        name: "Contact detection test per ISO/TS 15066",
        parentKey: "req-torque",
        state: "Todo",
        milestone: "beta",
        estimatedHours: 12
      },
      {
        key: "req-payload",
        type: "Requirement",
        name: "Carry 8 kg at full reach",
        parentKey: "arm",
        state: "Done",
        milestone: "alpha"
      },
      {
        key: "task-gearbox",
        type: "Task",
        name: "Select the wrist gearbox",
        parentKey: "req-payload",
        state: "Done",
        milestone: "alpha",
        estimatedHours: 14
      },
      {
        key: "tc-payload",
        type: "Test Case",
        name: "Payload test at full reach",
        parentKey: "req-payload",
        state: "Todo",
        milestone: "beta",
        estimatedHours: 6
      },
      {
        key: "control",
        type: "System",
        name: "Controller",
        state: "Backlog",
        budget: 45000
      },
      {
        key: "req-api",
        type: "Requirement",
        name: "Expose a REST API for motion commands",
        parentKey: "control",
        state: "Backlog"
      },
      {
        key: "task-api",
        type: "Task",
        name: "Draft the motion API specification",
        parentKey: "req-api",
        state: "Backlog",
        estimatedHours: 10
      },
      {
        key: "p-mass",
        type: "Parameter",
        name: "Arm mass",
        parentKey: "arm",
        state: "In Progress",
        parameter: { source: "Sum", unit: "kg" }
      },
      {
        key: "p-mass-a",
        type: "Parameter",
        name: "Link mass",
        parentKey: "p-mass",
        state: "In Progress",
        parameter: { source: "Manual", value: 9.5, unit: "kg" }
      },
      {
        key: "p-mass-b",
        type: "Parameter",
        name: "Joint drive mass",
        parentKey: "p-mass",
        state: "In Progress",
        parameter: { source: "Manual", value: 6, unit: "kg" }
      },
      {
        key: "req-mass-budget",
        type: "Requirement",
        name: "Arm mass at most 18 kg",
        parentKey: "arm",
        state: "In Review",
        requirement: {
          category: "Performance",
          operator: "≤",
          target: 18,
          unit: "kg",
          verificationMethod: "Test",
          actualParameter: "p-mass"
        }
      },
      {
        key: "tc-mass",
        type: "Test Case",
        name: "Weigh the beta arm",
        parentKey: "req-mass-budget",
        state: "Done",
        verdict: "Pass"
      },
      {
        key: "p-supply",
        type: "Parameter",
        name: "Controller power available",
        parentKey: "arm",
        state: "In Progress",
        parameter: { source: "Manual", value: 400, unit: "W" }
      },
      {
        key: "p-load",
        type: "Parameter",
        name: "Joint drive power draw",
        parentKey: "arm",
        state: "In Progress",
        parameter: { source: "Manual", value: 340, unit: "W" }
      },
      {
        key: "p-margin",
        type: "Parameter",
        name: "Controller power margin",
        parentKey: "arm",
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
        name: "Controller power margin stays positive",
        parentKey: "arm",
        state: "Todo",
        requirement: {
          category: "Design Constraint",
          operator: "≥",
          target: 0,
          unit: "W",
          verificationMethod: "Analysis",
          actualParameter: "p-margin"
        }
      }
    ],
    links: [
      { from: "arm", to: "req-mass-budget", type: "satisfies" },
      { from: "tc-mass", to: "req-mass-budget", type: "verifies" },
      { from: "task-sensor", to: "tc-contact", type: "precedes" }
    ]
  }
];

export const LABOR_CATEGORIES: LaborCategorySpec[] = [
  {
    name: "Robotics Engineer",
    description: "Designs and programs robot cells",
    costRate: 88
  },
  {
    name: "Controls Technician",
    description: "Wires and commissions controls",
    costRate: 62
  },
  {
    name: "Mechanical Engineer",
    description: "Designs fixtures and mechanisms",
    costRate: 84
  }
];

// Draft this week, Submitted last week: the timesheet and the approvals queue.
export const TIMESHEET_ENTRIES: TimesheetEntrySpec[] = [
  {
    project: "lakeshore-cell",
    element: "task-safety",
    laborCategory: "Controls Technician",
    week: -1,
    weekday: 0,
    hours: 6,
    status: "Submitted",
    note: "Safety controller wiring"
  },
  {
    project: "lakeshore-cell",
    element: "tc-cycle",
    laborCategory: "Robotics Engineer",
    week: -1,
    weekday: 1,
    hours: 4,
    status: "Submitted"
  },
  {
    project: "cobot-gen2",
    element: "task-sensor",
    laborCategory: "Robotics Engineer",
    week: -1,
    weekday: 2,
    hours: 7.5,
    status: "Submitted"
  },
  {
    project: "cobot-gen2",
    element: "task-gearbox",
    laborCategory: "Mechanical Engineer",
    week: -1,
    weekday: 3,
    hours: 3,
    status: "Submitted"
  },
  {
    project: "lakeshore-cell",
    element: "task-safety",
    laborCategory: "Controls Technician",
    week: 0,
    weekday: 0,
    hours: 5,
    status: "Draft"
  },
  {
    project: "lakeshore-cell",
    element: "tc-safety",
    laborCategory: "Robotics Engineer",
    week: 0,
    weekday: 1,
    hours: 2,
    status: "Draft"
  },
  {
    project: "cobot-gen2",
    element: "task-sensor",
    laborCategory: "Robotics Engineer",
    week: 0,
    weekday: 0,
    hours: 6,
    status: "Draft"
  },
  {
    project: "cobot-gen2",
    element: "tc-contact",
    laborCategory: "Mechanical Engineer",
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
    skippedReason: "No negative bins after the quarter-end physical count"
  },
  {
    definition: "Review financial statements",
    status: "Open",
    notes: "CFO to review the Lakeshore retrofit margin"
  }
];

export const roboticsAccounting: AccountingData = {
  fixedAssets: FIXED_ASSETS,
  journalEntries: JOURNAL_ENTRIES,
  payments: PAYMENTS,
  memos: MEMOS,
  projects: PROJECTS,
  laborCategories: LABOR_CATEGORIES,
  timesheetEntries: TIMESHEET_ENTRIES,
  customDimension: {
    name: "Product Line",
    values: ["Collaborative Arms", "Mobile Platforms"]
  },
  closeTasks: CLOSE_TASKS,
  // EUR per 1 USD (foreign units per base unit), the same direction as the EUR purchase order's 0.92 snapshot.
  exchangeRateOverrides: [{ currencyCode: "EUR", rate: 0.9215 }],
  billingAddresses: {
    receivable: {
      addressLine1: "2200 Technology Drive",
      city: "Pittsburgh",
      state: "PA",
      postalCode: "15219",
      countryCode: "US",
      phone: "+1-412-555-0184",
      email: "ar@helixrobotics.example"
    },
    payable: {
      addressLine1: "2200 Technology Drive",
      city: "Pittsburgh",
      state: "PA",
      postalCode: "15219",
      countryCode: "US",
      phone: "+1-412-555-0185",
      email: "ap@helixrobotics.example"
    }
  }
};
