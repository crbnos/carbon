/**
 * Validation for counterparty bank identifiers.
 *
 * These are format/checksum checks only — they prove a value is well-formed,
 * not that the account exists or belongs to the supplier. Confirming that is
 * an out-of-band process (a phone call to a known number), not a regex.
 */

/**
 * ISO 13616 IBAN check: move the first four characters to the end, expand
 * letters to digits (A=10 … Z=35), then the whole number mod 97 must equal 1.
 */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, (c) =>
    (c.charCodeAt(0) - 55).toString()
  );

  // The expanded value exceeds Number.MAX_SAFE_INTEGER, so fold digit by digit
  // rather than parsing it as a single number.
  let remainder = 0;
  for (const digit of expanded) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }

  return remainder === 1;
}

/**
 * ABA routing transit number check: exactly 9 digits, and the 3-7-1 weighted
 * sum must be divisible by 10.
 */
export function isValidAbaRouting(raw: string): boolean {
  const digits = raw.replace(/\s+/g, "");
  if (!/^[0-9]{9}$/.test(digits)) return false;

  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1] as const;
  const sum = digits
    .split("")
    .reduce((acc, digit, i) => acc + Number(digit) * (weights[i] ?? 0), 0);

  return sum % 10 === 0;
}

/** ISO 9362 BIC: 8 or 11 characters — 6 letters, then 2 alphanumerics, then an optional 3-character branch. */
export function isValidSwiftBic(raw: string): boolean {
  const bic = raw.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);
}

/**
 * Characters 5-6 of a BIC are its ISO 3166 country code, so a BIC can be checked
 * against the account's own country: a German BIC on a French account is a
 * mistake the format check alone cannot see.
 *
 * Returns true when either value is absent or the BIC is malformed — this
 * answers only "do these disagree?", leaving presence and format to their own
 * validators so one bad field raises one error.
 */
export function bicMatchesCountry(
  bic: string | null | undefined,
  countryCode: string | null | undefined
): boolean {
  if (!bic || !countryCode) return true;
  const normalized = bic.replace(/\s+/g, "").toUpperCase();
  if (!isValidSwiftBic(normalized)) return true;
  return normalized.slice(4, 6) === countryCode.toUpperCase();
}

/**
 * Last four characters of an account identifier, for display.
 * Returns "••••" when the value is too short to partially mask.
 */
export function maskAccountNumber(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.replace(/\s+/g, "");
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/**
 * Per-country bank field configuration.
 *
 * Countries differ in what the account identifier is called (IBAN, account
 * number) and whether they use a routing identifier at all (ABA, sort code,
 * BSB, IFSC, transit number). Rather than one column per scheme — which needs a
 * migration per country — `accountNumber` and `bankCode` are generic, and this
 * map decides how each is labelled and validated. Adding a country is an entry
 * here, not a schema change.
 *
 * A country with no entry falls back to DEFAULT_BANK_FIELDS: both fields
 * present, format-checked only. That is deliberate — an unlisted country must
 * still be enterable.
 */
export type AccountLabelKey = "accountNumber" | "iban";
export type BankCodeLabelKey =
  | "aba"
  | "sortCode"
  | "bsb"
  | "ifsc"
  | "transit"
  | "bankCode";

export type BankFieldConfig = {
  /**
   * Label KEYS, not display strings — @carbon/utils has no Lingui runtime, and
   * a hardcoded English label here would be untranslatable. The form maps these
   * to `t` messages.
   */
  accountLabel: AccountLabelKey;
  /** Routing identifier label key, or null when the country has none. */
  bankCodeLabel: BankCodeLabelKey | null;
  /** Validator for the account identifier; undefined = format check only. */
  validateAccount?: (value: string) => boolean;
  /** Validator for the routing identifier. */
  validateBankCode?: (value: string) => boolean;
  /** True when SWIFT/BIC is expected for cross-border payment. */
  requiresSwift?: boolean;
};

/** UK sort code: six digits, conventionally written 00-00-00. */
export function isValidSortCode(raw: string): boolean {
  return /^[0-9]{6}$/.test(raw.replace(/[\s-]/g, ""));
}

/** Australian BSB: six digits, conventionally written 000-000. */
export function isValidBsb(raw: string): boolean {
  return /^[0-9]{6}$/.test(raw.replace(/[\s-]/g, ""));
}

/** Indian IFSC: four letters, a zero, then six alphanumerics. */
export function isValidIfsc(raw: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(raw.replace(/\s/g, "").toUpperCase());
}

/** Canadian routing: five-digit transit plus three-digit institution. */
export function isValidCanadianRouting(raw: string): boolean {
  return /^[0-9]{8}$/.test(raw.replace(/[\s-]/g, ""));
}

function stripSeparators(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

/**
 * US account number: 4-17 digits. Domestic account numbers carry no checksum —
 * unlike an IBAN or an ABA there is no offline way to prove one is real, so
 * these validators check only the alphabet and length the scheme allows. That
 * still catches the common case: a letter in a US account number is a typo.
 * There is no ACH-wide length standard; this range is the practical one.
 */
export function isValidUsAccountNumber(raw: string): boolean {
  return /^[0-9]{4,17}$/.test(stripSeparators(raw));
}

/** UK: exactly 8 digits. */
export function isValidUkAccountNumber(raw: string): boolean {
  return /^[0-9]{8}$/.test(stripSeparators(raw));
}

/** Australia: 5-10 digits. */
export function isValidAuAccountNumber(raw: string): boolean {
  return /^[0-9]{5,10}$/.test(stripSeparators(raw));
}

/** Canada: 7-12 digits. */
export function isValidCaAccountNumber(raw: string): boolean {
  return /^[0-9]{7,12}$/.test(stripSeparators(raw));
}

/**
 * India: 9-18 characters. Alphanumeric on purpose — a few Indian banks really
 * do issue account numbers containing letters, so this checks length and
 * rejects punctuation rather than forcing digits.
 */
export function isValidInAccountNumber(raw: string): boolean {
  return /^[A-Z0-9]{9,18}$/.test(stripSeparators(raw).toUpperCase());
}

const IBAN_COUNTRY: BankFieldConfig = {
  accountLabel: "iban",
  bankCodeLabel: null,
  validateAccount: isValidIban,
  requiresSwift: true
};

const BANK_FIELDS: Record<string, BankFieldConfig> = {
  US: {
    accountLabel: "accountNumber",
    validateAccount: isValidUsAccountNumber,
    bankCodeLabel: "aba",
    validateBankCode: isValidAbaRouting
  },
  GB: {
    accountLabel: "accountNumber",
    validateAccount: isValidUkAccountNumber,
    bankCodeLabel: "sortCode",
    validateBankCode: isValidSortCode
  },
  AU: {
    accountLabel: "accountNumber",
    validateAccount: isValidAuAccountNumber,
    bankCodeLabel: "bsb",
    validateBankCode: isValidBsb
  },
  // India needs BOTH: the IFSC routes the payment domestically once it lands,
  // the BIC gets it into the country. Neither substitutes for the other.
  IN: {
    accountLabel: "accountNumber",
    validateAccount: isValidInAccountNumber,
    bankCodeLabel: "ifsc",
    validateBankCode: isValidIfsc,
    requiresSwift: true
  },
  CA: {
    accountLabel: "accountNumber",
    validateAccount: isValidCaAccountNumber,
    bankCodeLabel: "transit",
    validateBankCode: isValidCanadianRouting
  },
  // SEPA: the IBAN carries the bank identifier, so there is no separate code.
  AT: IBAN_COUNTRY,
  BE: IBAN_COUNTRY,
  DE: IBAN_COUNTRY,
  ES: IBAN_COUNTRY,
  FI: IBAN_COUNTRY,
  FR: IBAN_COUNTRY,
  IE: IBAN_COUNTRY,
  IT: IBAN_COUNTRY,
  NL: IBAN_COUNTRY,
  PL: IBAN_COUNTRY,
  PT: IBAN_COUNTRY,
  SE: IBAN_COUNTRY
};

export const DEFAULT_BANK_FIELDS: BankFieldConfig = {
  accountLabel: "accountNumber",
  bankCodeLabel: "bankCode",
  requiresSwift: true
};

export function getBankFieldConfig(
  countryCode: string | null | undefined
): BankFieldConfig {
  if (!countryCode) return DEFAULT_BANK_FIELDS;
  return BANK_FIELDS[countryCode.toUpperCase()] ?? DEFAULT_BANK_FIELDS;
}
