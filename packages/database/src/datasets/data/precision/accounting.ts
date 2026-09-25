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
    key: "compressor",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Rotary Screw Air Compressor 75 HP",
    description: "Plant air for the machining cells, fab bay and CMM lab",
    serialNumber: "RSC-75-204418",
    status: "Active",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    acquisitionCost: 72000,
    acquisitionOffset: -941,
    depreciationStartOffset: -910,
    accumulatedDepreciation: 0,
    // 68,400 / 120 = 570 per month x the 30 months from the depreciation start
    // to the run's period end
    depreciationCharge: 17100
  },
  {
    key: "vmc",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "5-Axis Vertical Machining Center",
    description: "Trunnion 5-axis VMC running the manifold and housing work",
    serialNumber: "VMC-5X-770213",
    status: "Active",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 5,
    acquisitionCost: 480000,
    acquisitionOffset: -521,
    depreciationStartOffset: -485,
    accumulatedDepreciation: 0,
    // 456,000 / 120 = 3,800 per month x the 16 months from the depreciation
    // start to the run's period end
    depreciationCharge: 60800
  },
  {
    key: "lathe",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Twin-Spindle CNC Turning Center",
    description: "Awaiting registration — acquisition cost booked on register",
    serialNumber: "TRN-2S-118904",
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
    key: "truck",
    className: "Vehicles",
    location: "HQ",
    name: "Delivery Box Truck",
    description: "Local runs to the anodizer, the heat treater and customers",
    serialNumber: "VIN-1FDWE3FN2LDC42817",
    status: "Fully Depreciated",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 60,
    residualValuePercent: 0,
    acquisitionCost: 58000,
    acquisitionOffset: -2617,
    depreciationStartOffset: -2586,
    accumulatedDepreciation: 58000
  },
  {
    key: "knee-mill",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Manual Knee Mill",
    description:
      "Toolroom knee mill retired after the second VMC arrived; sold at a machinery auction",
    serialNumber: "KM-3VS-48213",
    status: "Disposed",
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 120,
    residualValuePercent: 0,
    acquisitionCost: 36000,
    acquisitionOffset: -3400,
    depreciationStartOffset: -3380,
    // 36,000 / 120 = 300 per month x the 110 months depreciated before sale.
    // NBV 3,000 against 4,200 proceeds books a 1,200 gain.
    accumulatedDepreciation: 33000,
    disposal: { dateOffset: -35, method: "Sale", saleProceeds: 4200 }
  },
  {
    key: "wire-edm",
    className: "Machinery & Equipment",
    location: "Plant",
    name: "Wire EDM Machine",
    description:
      "Wire EDM for punch and die profiles, depreciated by burn hours",
    serialNumber: "EDM-W4-70316",
    status: "Active",
    depreciationMethod: "Units of Production",
    usefulLifeMonths: 96,
    residualValuePercent: 0,
    acquisitionCost: 88000,
    acquisitionOffset: -120,
    depreciationStartOffset: -100,
    // 88,000 / 20,000 hours = 4.40 per hour. The first logged month (290 h)
    // was booked on registration; the run's month (335 h) is the charge.
    assetLifetimeUsage: 20000,
    accumulatedDepreciation: 1276,
    usageLogs: [
      { monthsBack: 2, unitsProduced: 290 },
      { monthsBack: 1, unitsProduced: 335 }
    ],
    depreciationCharge: 1474
  }
];

export const JOURNAL_ENTRIES: JournalEntrySpec[] = [
  {
    ref: "journal:revenue",
    journalEntryId: "JE-SEED-001",
    description: "Revenue recognition — Cedar Valley partial delivery",
    status: "Draft",
    postingOffset: -145,
    lines: [
      {
        accountClass: "Asset",
        description: "Cedar Valley power unit milestone",
        amount: 7960,
        quantity: 2,
        journalLineReference: "JE-SEED-001"
      },
      {
        // Positive on a Revenue account IS the credit — the journalEntries view
        // derives debit/credit from account class AND sign, so a negative here
        // reads as a second debit and the entry blocks period close.
        accountClass: "Revenue",
        description: "Cedar Valley power unit milestone",
        amount: 7960,
        quantity: 2,
        journalLineReference: "JE-SEED-001"
      }
    ]
  },
  {
    ref: "journal:payroll-accrual",
    journalEntryId: "JE-SEED-002",
    description: "Payroll accrual — second-shift machinists, final week",
    status: "Posted",
    postingOffset: -12,
    lines: [
      {
        account: "6060",
        description: "Accrued second-shift machinist wages",
        amount: 22800,
        quantity: 1,
        journalLineReference: "JE-SEED-002-1",
        dimensions: [
          { dimension: "Project", value: "solstice-fixture" },
          { dimension: "Work Cell", value: "5-Axis Milling" }
        ]
      },
      {
        account: "2150",
        description: "Accrued second-shift machinist wages",
        amount: 22800,
        quantity: 1,
        journalLineReference: "JE-SEED-002-2"
      }
    ]
  },
  {
    ref: "journal:amortization",
    journalEntryId: "JE-SEED-003",
    description: "Monthly amortization — CAM software license",
    status: "Posted",
    postingOffset: -23,
    lines: [
      {
        account: "6310",
        description: "CAM software license amortization",
        amount: 640,
        quantity: 1,
        journalLineReference: "JE-SEED-003"
      },
      {
        // A credit on the contra-asset: negative on a debit-normal class.
        account: "1420",
        description: "CAM software license amortization",
        amount: -640,
        quantity: 1,
        journalLineReference: "JE-SEED-003"
      }
    ]
  },
  {
    ref: "journal:calibration-accrual",
    journalEntryId: "JE-SEED-004",
    description:
      "Accrued gauge calibration service — duplicate of vendor invoice",
    status: "Reversed",
    postingOffset: -40,
    lines: [
      {
        account: "6080",
        description: "Gauge calibration service",
        amount: 3150,
        quantity: 1,
        journalLineReference: "JE-SEED-004"
      },
      {
        account: "2140",
        description: "Gauge calibration service",
        amount: 3150,
        quantity: 1,
        journalLineReference: "JE-SEED-004"
      }
    ],
    reversal: {
      ref: "journal:calibration-accrual-reversal",
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
        amount: 420000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-1"
      },
      {
        account: "1210",
        description: "Raw materials on hand",
        amount: 95000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-2"
      },
      {
        account: "1220",
        description: "Finished goods on hand",
        amount: 70000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-3"
      },
      {
        account: "1350",
        description: "Machinery & equipment at cost",
        amount: 1250000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-4"
      },
      {
        account: "1330",
        description: "Accumulated depreciation to date",
        amount: -380000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-5"
      },
      {
        account: "2410",
        description: "Equipment term loan",
        amount: 500000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-6"
      },
      {
        account: "3010",
        description: "Paid-in capital",
        amount: 400000,
        quantity: 1,
        journalLineReference: "JE-SEED-006-7"
      },
      {
        account: "3100",
        description: "Retained earnings brought forward",
        amount: 555000,
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
    key: "cedar-ach",
    type: "Receipt",
    customer: "Cedar Valley Hydraulics",
    dateOffset: -44,
    amount: 345,
    reference: "ACH 3308-4410",
    applies: [{ invoiceKey: "paid", amount: 345 }]
  },
  {
    key: "dominion-check",
    type: "Receipt",
    customer: "Dominion Ag Equipment",
    dateOffset: -9,
    amount: 78,
    reference: "CHK 5561",
    applies: [{ invoiceKey: "partial", amount: 78 }]
  },
  {
    key: "granite-credit",
    type: "Receipt",
    customer: "Granite State Instruments",
    dateOffset: -49,
    amount: 0,
    reference: "Credit application",
    applies: [],
    credits: [{ memoKey: "granite-sheet", invoiceKey: "credit", amount: 225 }]
  },
  {
    key: "midway-ach",
    type: "Disbursement",
    supplier: "Midway Bearing & Seal",
    dateOffset: -31,
    amount: 118.2,
    reference: "ACH 6120-7734",
    applies: [{ invoiceKey: "paid", amount: 118.2 }]
  },
  {
    key: "midway-check",
    type: "Disbursement",
    supplier: "Midway Bearing & Seal",
    dateOffset: -13,
    amount: 140,
    reference: "CHK 30871",
    applies: [{ invoiceKey: "partial", amount: 140 }]
  },
  {
    key: "bluestem-debit",
    type: "Disbursement",
    supplier: "Bluestem Alloys",
    dateOffset: -66,
    amount: 0,
    reference: "Debit application",
    applies: [],
    credits: [
      { memoKey: "bluestem-plate", invoiceKey: "debit-note", amount: 500 }
    ]
  },
  {
    key: "draft-receipt",
    type: "Receipt",
    status: "Draft",
    customer: "Granite State Instruments",
    dateOffset: -1,
    amount: 360,
    reference: "Check 30912 — 316 plate",
    applies: []
  },
  {
    key: "draft-disbursement",
    type: "Disbursement",
    status: "Draft",
    supplier: "Rock River Metals",
    dateOffset: 0,
    amount: 442.5,
    reference: "ACH batch 0930 — bar stock",
    applies: []
  }
];

export const MEMOS: MemoSpec[] = [
  {
    key: "granite-sheet",
    direction: "Credit",
    customer: "Granite State Instruments",
    invoiceKey: "credit",
    dateOffset: -52,
    amount: 225,
    notes: "Full credit — 5052 sheet remnant shipped in the wrong temper"
  },
  {
    key: "bluestem-plate",
    direction: "Debit",
    supplier: "Bluestem Alloys",
    invoiceKey: "debit-note",
    dateOffset: -70,
    amount: 500,
    notes:
      "316L plate failed the mill-cert review at the dock — billing debited"
  }
];

export const PROJECTS: ProjectSpec[] = [
  {
    key: "solstice-fixture",
    name: "Solstice Surgical Fixture Program",
    description:
      "Validated fixture family for Solstice Medical's instrument line",
    purchaseInvoiceLine: { invoiceKey: "paid", item: "BRG-DBL-6205" }
  },
  {
    key: "five-axis-expansion",
    name: "Five-Axis Capacity Expansion",
    description: "Second 5-axis cell with pallet automation"
  }
];

export const CLOSE_TASKS: PeriodCloseTaskSpec[] = [
  { definition: "Post pending operational documents", status: "Done" },
  {
    definition: "Review negative on-hand inventory",
    status: "Skipped",
    skippedReason: "Bin audit ran clean the week before month end"
  },
  {
    definition: "Review financial statements",
    status: "Open",
    notes: "Owner to review shop-rate variance"
  }
];

export const precisionAccounting: AccountingData = {
  fixedAssets: FIXED_ASSETS,
  journalEntries: JOURNAL_ENTRIES,
  payments: PAYMENTS,
  memos: MEMOS,
  projects: PROJECTS,
  customDimension: {
    name: "Work Cell",
    values: ["Swiss Turning", "5-Axis Milling"]
  },
  closeTasks: CLOSE_TASKS,
  // EUR per 1 USD (foreign units per base unit), the same direction as the EUR purchase order's 0.92 snapshot.
  exchangeRateOverrides: [{ currencyCode: "EUR", rate: 0.9215 }],
  billingAddresses: {
    receivable: {
      addressLine1: "1725 Kishwaukee Street",
      city: "Rockford",
      state: "IL",
      postalCode: "61104",
      countryCode: "US",
      phone: "+1-815-555-0194",
      email: "ar@meridianprecision.example"
    },
    payable: {
      addressLine1: "1725 Kishwaukee Street",
      city: "Rockford",
      state: "IL",
      postalCode: "61104",
      countryCode: "US",
      phone: "+1-815-555-0195",
      email: "ap@meridianprecision.example"
    }
  }
};
