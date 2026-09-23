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
  }
];

// Settles the lifecycle invoices: "paid" in full, "partial" in part, and
// the Credit/Debit Note Issued invoices by their memos (zero-cash credit
// applications, the way applyCreditsToInvoices records them).
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
    purchaseInvoiceLine: { invoiceKey: "paid", item: "MAT-CU-18AWG" }
  },
  {
    key: "dyno-automation",
    name: "Dyno Cell Automation",
    description:
      "Automated load profiles and data capture for end-of-line testing"
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
  customDimension: {
    name: "Motor Family",
    values: ["Traction Motors", "Industrial Servo"]
  },
  closeTasks: CLOSE_TASKS,
  // EUR per 1 USD (foreign units per base unit), the same direction as the EUR purchase order's 0.92 snapshot.
  exchangeRateOverrides: [{ currencyCode: "EUR", rate: 0.9215 }]
};
