import type { Database } from "@carbon/database";
import type {
  getAccount,
  getAccountsList,
  getCostCenters,
  getCostCentersTree,
  getCurrencies,
  getDimension,
  getDimensions,
  getJournalEntries,
  getJournalEntry,
  getPaymentTerms
} from "./accounting.service";

export type Account = NonNullable<
  Awaited<ReturnType<typeof getAccount>>["data"]
>;

export type AccountConsolidatedRate =
  Database["public"]["Enums"]["glConsolidatedRate"];

export type AccountListItem = NonNullable<
  NonNullable<Awaited<ReturnType<typeof getAccountsList>>>["data"]
>[number];

export type AccountIncomeBalance =
  Database["public"]["Enums"]["glIncomeBalance"];

export type AccountClass = Database["public"]["Enums"]["glAccountClass"];

export type AccountType = Database["public"]["Enums"]["accountType"];

export type Chart = Account & Transaction;

// Synthetic id for the computed "Net Income" equity line on the balance sheet
// (undistributed current earnings rolled into equity — never a posted account).
// Shared so the report tree can recognize and order/decorate the row.
export const NET_INCOME_ACCOUNT_ID = "net-income";

export type CostCenter = NonNullable<
  Awaited<ReturnType<typeof getCostCenters>>["data"]
>[number];

export type CostCenterTreeNode = NonNullable<
  Awaited<ReturnType<typeof getCostCentersTree>>["data"]
>[number];

export type Currency = NonNullable<
  Awaited<ReturnType<typeof getCurrencies>>["data"]
>[number];

export type Dimension = NonNullable<
  Awaited<ReturnType<typeof getDimensions>>["data"]
>[number];

export type DimensionDetail = NonNullable<
  Awaited<ReturnType<typeof getDimension>>["data"]
>;

export const currencyCodes = [
  "AFN",
  "AFA",
  "ALL",
  "ALK",
  "DZD",
  "ADP",
  "AOA",
  "AOK",
  "AON",
  "AOR",
  "ARA",
  "ARS",
  "ARM",
  "ARP",
  "ARL",
  "AMD",
  "AWG",
  "AUD",
  "ATS",
  "AZN",
  "AZM",
  "BSD",
  "BHD",
  "BDT",
  "BBD",
  "BYN",
  "BYB",
  "BYR",
  "BEF",
  "BEC",
  "BEL",
  "BZD",
  "BMD",
  "BTN",
  "BOB",
  "BOL",
  "BOV",
  "BOP",
  "BAM",
  "BAD",
  "BAN",
  "BWP",
  "BRC",
  "BRZ",
  "BRE",
  "BRR",
  "BRN",
  "BRB",
  "BRL",
  "GBP",
  "BND",
  "BGL",
  "BGN",
  "BGO",
  "BGM",
  "BUK",
  "BIF",
  "XPF",
  "KHR",
  "CAD",
  "CVE",
  "KYD",
  "XAF",
  "CLE",
  "CLP",
  "CLF",
  "CNX",
  "CNY",
  "CNH",
  "COP",
  "COU",
  "KMF",
  "CDF",
  "CRC",
  "HRD",
  "HRK",
  "CUC",
  "CUP",
  "CYP",
  "CZK",
  "CSK",
  "DKK",
  "DJF",
  "DOP",
  "NLG",
  "XCD",
  "DDM",
  "ECS",
  "ECV",
  "EGP",
  "GQE",
  "ERN",
  "EEK",
  "ETB",
  "EUR",
  "XBA",
  "XEU",
  "XBB",
  "XBC",
  "XBD",
  "FKP",
  "FJD",
  "FIM",
  "FRF",
  "XFO",
  "XFU",
  "GMD",
  "GEK",
  "GEL",
  "DEM",
  "GHS",
  "GHC",
  "GIP",
  "XAU",
  "GRD",
  "GTQ",
  "GWP",
  "GNF",
  "GNS",
  "GYD",
  "HTG",
  "HNL",
  "HKD",
  "HUF",
  "IMP",
  "ISK",
  "ISJ",
  "INR",
  "IDR",
  "IRR",
  "IQD",
  "IEP",
  "ILS",
  "ILP",
  "ILR",
  "ITL",
  "JMD",
  "JPY",
  "JOD",
  "KZT",
  "KES",
  "KWD",
  "KGS",
  "LAK",
  "LVL",
  "LVR",
  "LBP",
  "LSL",
  "LRD",
  "LYD",
  "LTL",
  "LTT",
  "LUL",
  "LUC",
  "LUF",
  "MOP",
  "MKD",
  "MKN",
  "MGA",
  "MGF",
  "MWK",
  "MYR",
  "MVR",
  "MVP",
  "MLF",
  "MTL",
  "MTP",
  "MRU",
  "MRO",
  "MUR",
  "MXV",
  "MXN",
  "MXP",
  "MDC",
  "MDL",
  "MCF",
  "MNT",
  "MAD",
  "MAF",
  "MZE",
  "MZN",
  "MZM",
  "MMK",
  "NAD",
  "NPR",
  "ANG",
  "TWD",
  "NZD",
  "NIO",
  "NIC",
  "NGN",
  "KPW",
  "NOK",
  "OMR",
  "PKR",
  "XPD",
  "PAB",
  "PGK",
  "PYG",
  "PEI",
  "PEN",
  "PES",
  "PHP",
  "XPT",
  "PLN",
  "PLZ",
  "PTE",
  "GWE",
  "QAR",
  "XRE",
  "RHD",
  "RON",
  "ROL",
  "RUB",
  "RUR",
  "RWF",
  "SVC",
  "WST",
  "SAR",
  "RSD",
  "CSD",
  "SCR",
  "SLL",
  "XAG",
  "SGD",
  "SKK",
  "SIT",
  "SBD",
  "SOS",
  "ZAR",
  "ZAL",
  "KRH",
  "KRW",
  "KRO",
  "SSP",
  "SUR",
  "ESP",
  "ESA",
  "ESB",
  "XDR",
  "LKR",
  "SHP",
  "XSU",
  "SDD",
  "SDG",
  "SDP",
  "SRD",
  "SRG",
  "SZL",
  "SEK",
  "CHF",
  "SYP",
  "STN",
  "STD",
  "TVD",
  "TJR",
  "TJS",
  "TZS",
  "XTS",
  "THB",
  "XXX",
  "TPE",
  "TOP",
  "TTD",
  "TND",
  "TRY",
  "TRL",
  "TMT",
  "TMM",
  "USD",
  "USN",
  "USS",
  "UGX",
  "UGS",
  "UAH",
  "UAK",
  "AED",
  "UYW",
  "UYU",
  "UYP",
  "UYI",
  "UZS",
  "VUV",
  "VES",
  "VEB",
  "VEF",
  "VND",
  "VNN",
  "CHE",
  "CHW",
  "XOF",
  "YDD",
  "YER",
  "YUN",
  "YUD",
  "YUM",
  "YUR",
  "ZWN",
  "ZRN",
  "ZRZ",
  "ZMW",
  "ZMK",
  "ZWD",
  "ZWR",
  "ZWL",
  "XUA"
] as const;

export type CurrencyCode = (typeof currencyCodes)[number];

export type PaymentTermCalculationMethod =
  Database["public"]["Enums"]["paymentTermCalculationMethod"];

export type PaymentTerm = NonNullable<
  Awaited<ReturnType<typeof getPaymentTerms>>["data"]
>[number];

export type Transaction = {
  number: string;
  netChange: number;
  balanceAtDate: number;
  balance: number;
};

export type TranslatedBalance = {
  accountId: string;
  localBalance: number;
  exchangeRate: number;
  translatedBalance: number;
};

export type TranslatedTransaction = Transaction & {
  translatedBalance?: number;
  exchangeRate?: number;
};

export type JournalEntry = NonNullable<
  Awaited<ReturnType<typeof getJournalEntry>>["data"]
>;

export type JournalEntryListItem = NonNullable<
  NonNullable<Awaited<ReturnType<typeof getJournalEntries>>>["data"]
>[number];

export type JournalEntryLine = JournalEntry["journalLine"][number];

// -- Fixed Asset types --

import type {
  getAssetDepreciationHistory,
  getDepreciationRun,
  getDepreciationRunLines,
  getDepreciationRuns,
  getFixedAsset,
  getFixedAssetClass,
  getFixedAssetClasses,
  getFixedAssetDisposal,
  getFixedAssets
} from "./accounting.service";

export type FixedAssetClass = NonNullable<
  Awaited<ReturnType<typeof getFixedAssetClass>>["data"]
>;

export type FixedAssetClassListItem = NonNullable<
  NonNullable<Awaited<ReturnType<typeof getFixedAssetClasses>>>["data"]
>[number];

export type FixedAsset = NonNullable<
  Awaited<ReturnType<typeof getFixedAsset>>["data"]
>;

export type FixedAssetListItem = NonNullable<
  NonNullable<Awaited<ReturnType<typeof getFixedAssets>>>["data"]
>[number];

export type DepreciationRun = NonNullable<
  Awaited<ReturnType<typeof getDepreciationRun>>["data"]
>;

export type DepreciationRunListItem = NonNullable<
  NonNullable<Awaited<ReturnType<typeof getDepreciationRuns>>>["data"]
>[number];

export type DepreciationRunLineItem = NonNullable<
  NonNullable<Awaited<ReturnType<typeof getDepreciationRunLines>>>["data"]
>[number];

export type AssetDepreciationHistoryItem = NonNullable<
  NonNullable<Awaited<ReturnType<typeof getAssetDepreciationHistory>>>["data"]
>[number];

export type FixedAssetDisposal = NonNullable<
  Awaited<ReturnType<typeof getFixedAssetDisposal>>["data"]
>;
