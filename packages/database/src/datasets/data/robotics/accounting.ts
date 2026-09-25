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
    purchaseInvoiceLine: { invoiceKey: "paid", item: "ENC-ABS-19" }
  },
  {
    key: "cobot-gen2",
    name: "Cobot Arm Gen-2 Development",
    description:
      "Next-generation collaborative arm with integrated torque sensing"
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
