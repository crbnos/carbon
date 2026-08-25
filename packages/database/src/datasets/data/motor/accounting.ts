import type {
  AccountingData,
  FixedAssetSpec,
  JournalEntrySpec
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
  }
];

export const motorAccounting: AccountingData = {
  fixedAssets: FIXED_ASSETS,
  journalEntries: JOURNAL_ENTRIES
};
