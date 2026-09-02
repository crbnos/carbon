import type {
  AccountingData,
  FixedAssetSpec,
  JournalEntrySpec
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
  }
];

export const satelliteAccounting: AccountingData = {
  fixedAssets: FIXED_ASSETS,
  journalEntries: JOURNAL_ENTRIES
};
