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
  ProjectSpec,
  TimesheetEntrySpec
} from "../../types.ts";

export const FIXED_ASSETS: FixedAssetSpec[] = [
  {
    key: "hvac",
    className: "Buildings",
    location: "Plant",
    name: "ESD Integration Bay Fit-Out",
    description: "ESD flooring, grounding and benches for Integration Bay A",
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
    name: "Legacy Temperature Chamber",
    description:
      "1 m³ temperature chamber retired after the combined temperature-vibration chamber came online; sold to a university lab",
    serialNumber: "TCH-12-04417",
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
      "6 kW fiber laser for bracket and frame-plate blanks, depreciated by cutting hours",
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
    description: "Revenue recognition — Army DO 0003 partial delivery",
    status: "Draft",
    postingOffset: -256,
    lines: [
      {
        accountClass: "Asset",
        description: "Army DO 0003 CLIN 0001 milestone",
        amount: 195000,
        quantity: 1,
        journalLineReference: "JE-SEED-001"
      },
      {
        // Positive on a Revenue account IS the credit — the journalEntries view
        // derives debit/credit from account class AND sign, so a negative here
        // reads as a second debit and the entry blocks period close.
        accountClass: "Revenue",
        description: "Army DO 0003 CLIN 0001 milestone",
        amount: 195000,
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
          { dimension: "Program Phase", value: "Integration & Test" }
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
    description: "Monthly amortization — flight simulation software license",
    status: "Posted",
    postingOffset: -23,
    lines: [
      {
        account: "6310",
        description: "Flight simulation license amortization",
        amount: 1250,
        quantity: 1,
        journalLineReference: "JE-SEED-003"
      },
      {
        // A credit on the contra-asset: negative on a debit-normal class.
        account: "1420",
        description: "Flight simulation license amortization",
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
      "Accrued flight-test insurance premium — duplicate of broker invoice",
    status: "Reversed",
    postingOffset: -40,
    lines: [
      {
        account: "6100",
        description: "Flight-test insurance premium",
        amount: 9600,
        quantity: 1,
        journalLineReference: "JE-SEED-004"
      },
      {
        account: "2140",
        description: "Flight-test insurance premium",
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
    customer: "Army Small UAS Program Office",
    dateOffset: -47,
    amount: 2000,
    reference: "ACH 0417-2286",
    applies: [{ invoiceKey: "paid", amount: 2000 }]
  },
  {
    key: "apex-wire",
    type: "Receipt",
    customer: "Special Operations Aviation Command",
    dateOffset: -12,
    amount: 21000,
    reference: "WIRE 88213 — milestone 1 of 2",
    applies: [{ invoiceKey: "partial", amount: 21000 }]
  },
  {
    key: "novasat-credit",
    type: "Receipt",
    customer: "Northgate Defense Systems",
    dateOffset: -50,
    amount: 0,
    reference: "Credit application",
    applies: [],
    credits: [{ memoKey: "novasat-valves", invoiceKey: "credit", amount: 2850 }]
  },
  {
    key: "celestial-ach",
    type: "Disbursement",
    supplier: "Vanguard Electronics Supply",
    dateOffset: -33,
    amount: 4520,
    reference: "ACH 1120-5561",
    applies: [{ invoiceKey: "paid", amount: 4520 }]
  },
  {
    key: "celestial-check",
    type: "Disbursement",
    supplier: "Vanguard Electronics Supply",
    dateOffset: -14,
    amount: 1640,
    reference: "CHK 10442",
    applies: [{ invoiceKey: "partial", amount: 1640 }]
  },
  {
    key: "proptech-debit",
    type: "Disbursement",
    supplier: "Sentry Propulsion Systems",
    dateOffset: -66,
    amount: 0,
    reference: "Debit application",
    applies: [],
    credits: [
      { memoKey: "proptech-tanks", invoiceKey: "debit-note", amount: 840 }
    ]
  },
  {
    key: "draft-receipt",
    type: "Receipt",
    status: "Draft",
    customer: "Northgate Defense Systems",
    dateOffset: -1,
    amount: 4800,
    reference: "WIRE advice 4471 — carbon arm",
    applies: []
  },
  {
    key: "draft-disbursement",
    type: "Disbursement",
    status: "Draft",
    supplier: "Ridgeline Composites",
    dateOffset: 0,
    amount: 640,
    reference: "ACH batch 0930 — prepreg",
    applies: []
  }
];

export const MEMOS: MemoSpec[] = [
  {
    key: "novasat-valves",
    direction: "Credit",
    customer: "Northgate Defense Systems",
    invoiceKey: "credit",
    dateOffset: -52,
    amount: 2850,
    notes:
      "Full credit — Gen1 motors exceeded the vibration limit at Northgate acceptance test"
  },
  {
    key: "proptech-tanks",
    direction: "Debit",
    supplier: "Sentry Propulsion Systems",
    invoiceKey: "debit-note",
    dateOffset: -70,
    amount: 840,
    notes:
      "Both received carbon arms failed the UT delamination scan — billing debited"
  }
];

export const PROJECTS: ProjectSpec[] = [
  {
    key: "orbsec-block2",
    name: "Army ISR-4 Lot 2",
    description:
      "Twelve-air-vehicle follow-on lot for the Army Small UAS Program Office",
    identifier: "AL2",
    costTreatment: "Contract",
    status: "Released",
    // Government Contracting 5c: a Direct contract with budget control and
    // two control accounts. No earned value snapshot is seeded: the period
    // close writes them.
    costObjective: "Direct",
    budgetControl: "Warn",
    budgetTolerancePercent: 5,
    // The plan as awarded: the earned value baseline (BCWS and BAC).
    baseline: { name: "Contract award", dateOffset: -90 },
    // Phase 2a: the contract keeps its own stock — two parts received for
    // it, and fasteners transferred in from common stock.
    projectStock: {
      openingStock: [
        {
          item: "FST-M5-A286",
          shelf: "A1-L1",
          qty: 100,
          unitCost: 5.5,
          dateOffset: -30
        },
        {
          item: "MTR-4114-G1",
          shelf: "A3-L2",
          qty: 4,
          unitCost: 950,
          dateOffset: -30
        }
      ],
      transfers: [
        {
          item: "FST-M3-TI",
          shelf: "A1-L1",
          qty: 50,
          reason:
            "Kit the Lot 2 airframe fasteners for the first two air vehicles",
          dateOffset: -12
        }
      ]
    },
    purchaseInvoiceLine: { invoiceKey: "paid", item: "BAT-SMART-11AH" },
    milestones: [
      {
        key: "cdr",
        name: "Critical Design Review",
        startOffset: -60,
        endOffset: -10
      },
      {
        key: "first-article",
        name: "First Article Acceptance",
        startOffset: -9,
        endOffset: 45
      }
    ],
    elements: [
      {
        key: "air-vehicle",
        type: "System",
        name: "Air vehicle",
        state: "In Progress",
        budget: 180000,
        isControlAccount: true
      },
      {
        key: "req-endurance",
        type: "Requirement",
        name: "Air vehicle flies 55 minutes with the EO/IR payload",
        parentKey: "air-vehicle",
        state: "Done",
        milestone: "cdr"
      },
      {
        key: "task-battery",
        type: "Task",
        name: "Size the battery for end-of-life endurance",
        parentKey: "req-endurance",
        state: "Done",
        milestone: "cdr",
        estimatedHours: 24,
        earnedValueTechnique: "0/100",
        budget: 40000,
        startOffset: -80,
        targetOffset: -40
      },
      {
        key: "tc-endurance",
        type: "Test Case",
        name: "Hot-day endurance flight test",
        parentKey: "req-endurance",
        state: "Todo",
        milestone: "first-article",
        estimatedHours: 16
      },
      {
        key: "req-mass",
        type: "Requirement",
        name: "Takeoff mass under 9 kg",
        parentKey: "air-vehicle",
        state: "In Review"
      },
      {
        key: "task-mass",
        type: "Task",
        name: "Update the mass budget after the harness redesign",
        parentKey: "req-mass",
        state: "In Progress",
        estimatedHours: 12,
        earnedValueTechnique: "50/50",
        budget: 30000,
        startOffset: -50,
        targetOffset: 20
      },
      {
        key: "payload",
        type: "System",
        name: "Payload integration",
        state: "Todo",
        milestone: "first-article",
        budget: 95000,
        isControlAccount: true
      },
      {
        key: "req-pointing",
        type: "Requirement",
        name: "Gimbal line of sight stable within 50 microradians",
        parentKey: "payload",
        state: "Todo"
      },
      {
        key: "task-alignment",
        type: "Task",
        name: "Align the EO/IR gimbal to the air vehicle datum",
        parentKey: "req-pointing",
        state: "Backlog",
        milestone: "first-article",
        estimatedHours: 20,
        earnedValueTechnique: "Percent Complete",
        earnedValuePercent: 40,
        budget: 50000,
        startOffset: -30,
        targetOffset: 30
      },
      {
        key: "tc-pointing",
        type: "Test Case",
        name: "Line-of-sight stability test on the vibration table",
        parentKey: "req-pointing",
        state: "Backlog",
        estimatedHours: 10,
        earnedValueTechnique: "Level of Effort",
        budget: 25000,
        startOffset: -60,
        targetOffset: 60
      }
    ]
  },
  {
    key: "novasat-gen3",
    name: "ISR-4 Block II Qualification",
    description:
      "Qualification campaign for the Block II airframe and Gen2 motors",
    identifier: "BLK2",
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
        name: "Block II airframe",
        item: "AFR-100",
        state: "In Progress",
        budget: 120000
      },
      {
        key: "req-loads",
        type: "Requirement",
        name: "Survive a 6 g hard landing",
        parentKey: "structure",
        state: "In Progress",
        milestone: "qual-plan"
      },
      {
        key: "task-fem",
        type: "Task",
        name: "Correlate the finite element model to the drop test",
        parentKey: "req-loads",
        state: "In Progress",
        milestone: "qual-complete",
        estimatedHours: 40
      },
      {
        key: "tc-vibe",
        type: "Test Case",
        name: "MIL-STD-810H vibration qualification run",
        parentKey: "req-loads",
        state: "Todo",
        milestone: "qual-complete",
        estimatedHours: 16
      },
      {
        key: "req-stiffness",
        type: "Requirement",
        name: "First arm bending mode above 60 Hz",
        parentKey: "structure",
        state: "Todo"
      },
      {
        key: "tc-modal",
        type: "Test Case",
        name: "Modal survey on the qualification airframe",
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
        name: "Keep the battery between -20 and 55 °C",
        parentKey: "thermal",
        state: "Backlog"
      },
      {
        key: "task-heater",
        type: "Task",
        name: "Size the cold-weather battery heater",
        parentKey: "req-thermal",
        state: "Backlog",
        estimatedHours: 8
      },
      {
        key: "p-mass",
        type: "Parameter",
        name: "Airframe mass",
        parentKey: "structure",
        state: "In Progress",
        parameter: { source: "Sum", unit: "kg" }
      },
      {
        key: "p-mass-a",
        type: "Parameter",
        name: "Frame plate mass",
        parentKey: "p-mass",
        state: "In Progress",
        parameter: { source: "Manual", value: 1.6, unit: "kg" }
      },
      {
        key: "p-mass-b",
        type: "Parameter",
        name: "Arm set mass",
        parentKey: "p-mass",
        state: "In Progress",
        parameter: { source: "Manual", value: 1.1, unit: "kg" }
      },
      {
        key: "req-mass-budget",
        type: "Requirement",
        name: "Airframe mass at most 3 kg",
        parentKey: "structure",
        state: "In Review",
        requirement: {
          category: "Performance",
          operator: "≤",
          target: 3,
          unit: "kg",
          verificationMethod: "Test",
          actualParameter: "p-mass"
        }
      },
      {
        key: "tc-mass",
        type: "Test Case",
        name: "Weigh the qualification airframe",
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
      }
    ],
    links: [
      { from: "structure", to: "req-mass-budget", type: "satisfies" },
      { from: "tc-mass", to: "req-mass-budget", type: "verifies" },
      { from: "task-fem", to: "tc-vibe", type: "precedes" }
    ]
  },
  {
    key: "secure-bay",
    name: "Secure Integration Bay",
    description:
      "An access-controlled integration bay for controlled air vehicle builds, built in house and capitalized",
    identifier: "SIB",
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
        key: "accredited",
        name: "Bay Accredited",
        startOffset: 36,
        endOffset: 120
      }
    ],
    elements: [
      {
        key: "bay",
        type: "System",
        name: "Secure integration bay",
        state: "Todo",
        isFinalAsset: true,
        budget: 240000
      },
      {
        key: "req-access",
        type: "Requirement",
        name: "Badge and PIN access with a logged entry for every door",
        parentKey: "bay",
        state: "Todo",
        milestone: "accredited"
      },
      {
        key: "task-access",
        type: "Task",
        name: "Specify the access control readers and door hardware",
        parentKey: "req-access",
        state: "Todo",
        milestone: "design",
        estimatedHours: 24
      },
      {
        key: "tc-access",
        type: "Test Case",
        name: "Access control acceptance walk-through",
        parentKey: "req-access",
        state: "Backlog",
        milestone: "accredited",
        estimatedHours: 8
      },
      {
        key: "shell",
        type: "System",
        name: "Walls and ceiling",
        parentKey: "bay",
        state: "Todo",
        budget: 90000
      },
      {
        key: "task-walls",
        type: "Task",
        name: "Order the slab-to-slab wall panels",
        parentKey: "shell",
        state: "Backlog",
        milestone: "design",
        estimatedHours: 6
      },
      {
        key: "benches",
        type: "System",
        name: "ESD benches",
        parentKey: "bay",
        state: "Backlog",
        budget: 30000
      },
      {
        key: "task-layout",
        type: "Task",
        name: "Lay out the ESD benches",
        parentKey: "benches",
        state: "Backlog",
        estimatedHours: 4
      }
    ],
    links: [
      { from: "bay", to: "req-access", type: "satisfies" },
      { from: "tc-access", to: "req-access", type: "verifies" },
      { from: "task-walls", to: "task-layout", type: "precedes" }
    ]
  }
];

/**
 * Government contracting Phase 5b: the A&D cost structure. Fringe on total
 * labor, overhead on direct labor and G&A on total cost input. Administrative
 * salaries are G&A cost and part of the fringe base, so the fringe on them
 * carries into G&A. Burden and Actual rates come from the period run, which
 * the seed does not run.
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
    rate: 0.3
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
    rate: 0.9
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
    rate: 0.11
  }
];

export const LABOR_CATEGORIES: LaborCategorySpec[] = [
  {
    name: "Systems Engineer",
    description: "Owns requirements and air vehicle budgets",
    costRate: 90
  },
  {
    name: "Flight Test Technician",
    description: "Runs environmental, ground and flight tests",
    costRate: 56
  },
  {
    name: "Design Engineer",
    description: "Designs and analyses airframes and subsystems",
    costRate: 84
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
    element: "task-battery",
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
    element: "tc-vibe",
    laborCategory: "Flight Test Technician",
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
    element: "tc-endurance",
    laborCategory: "Flight Test Technician",
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
    laborCategory: "Flight Test Technician",
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
    notes: "Controller to review program margin on the Army IDIQ"
  }
];

export const defenseAccounting: AccountingData = {
  fixedAssets: FIXED_ASSETS,
  journalEntries: JOURNAL_ENTRIES,
  payments: PAYMENTS,
  memos: MEMOS,
  projects: PROJECTS,
  indirectPools: INDIRECT_POOLS,
  laborCategories: LABOR_CATEGORIES,
  timesheetEntries: TIMESHEET_ENTRIES,
  customDimension: {
    name: "Program Phase",
    values: ["Design & Qualification", "Integration & Test"]
  },
  closeTasks: CLOSE_TASKS,
  // EUR per 1 USD (foreign units per base unit), the same direction as the EUR purchase order's 0.92 snapshot.
  exchangeRateOverrides: [{ currencyCode: "EUR", rate: 0.9215 }],
  billingAddresses: {
    receivable: {
      addressLine1: "2750 Discovery Ridge Drive NW",
      city: "Huntsville",
      state: "AL",
      postalCode: "35806",
      countryCode: "US",
      phone: "+1-256-555-1140",
      email: "ar@halberd-uas.example"
    },
    payable: {
      addressLine1: "2750 Discovery Ridge Drive NW",
      city: "Huntsville",
      state: "AL",
      postalCode: "35806",
      countryCode: "US",
      phone: "+1-281-555-1150",
      email: "ap@halberd-uas.example"
    }
  }
};
