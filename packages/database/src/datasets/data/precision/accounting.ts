import type {
  AccountingData,
  FixedAssetSpec,
  JournalEntrySpec
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
  }
];

export const precisionAccounting: AccountingData = {
  fixedAssets: FIXED_ASSETS,
  journalEntries: JOURNAL_ENTRIES
};
