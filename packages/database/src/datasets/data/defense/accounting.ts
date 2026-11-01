// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  AccountingData,
  FixedAssetSpec,
  JournalEntrySpec,
  MemoSpec,
  PaymentSpec,
  PeriodCloseTaskSpec,
  ProjectSpec
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
    purchaseInvoiceLine: { invoiceKey: "paid", item: "BAT-SMART-11AH" }
  },
  {
    key: "novasat-gen3",
    name: "ISR-4 Block II Qualification",
    description:
      "Qualification campaign for the Block II airframe and Gen2 motors"
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
