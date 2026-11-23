// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** The lowercase form `credit` / `debit` take. */
export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense";

/** An account's class (`account.class`, the `glAccountClass` enum). */
export type AccountClass =
  | "Asset"
  | "Liability"
  | "Equity"
  | "Revenue"
  | "Expense";

const ACCOUNT_CLASSES: ReadonlySet<string> = new Set<AccountClass>([
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense"
]);

export function isAccountClass(value: string | null): value is AccountClass {
  return value !== null && ACCOUNT_CLASSES.has(value);
}

export const credit = (accountType: AccountType, amount: number) => {
  switch (accountType) {
    case "asset":
    case "expense":
      return -amount;
    case "liability":
    case "equity":
    case "revenue":
      return amount;
    default:
      throw new Error(`Invalid account type: ${accountType}`);
  }
};

export const debit = (accountType: AccountType, amount: number) => {
  switch (accountType) {
    case "asset":
    case "expense":
      return amount;
    case "liability":
    case "equity":
    case "revenue":
      return -amount;
    default:
      throw new Error(`Invalid account type: ${accountType}`);
  }
};

/** glAccountClass → the lowercase AccountType the debit/credit helpers expect,
 *  so a journal line's natural-balance sign follows the account's class. */
export const accountTypeFromClass = (glClass: string): AccountType => {
  if (!isAccountClass(glClass)) {
    throw new Error(`Unknown GL account class: ${glClass}`);
  }
  return glClass.toLowerCase() as AccountType;
};

/**
 * The debit-signed value (positive = debit) of a natural-balance-signed
 * amount on an account of this class. The mapping is its own inverse, so it
 * also turns a debit-signed value into the natural-signed amount a journal
 * line stores.
 */
export const debitSigned = (accountClass: AccountClass, amount: number) =>
  debit(accountTypeFromClass(accountClass), amount);

/**
 * The natural-signed amount a journal line stores for a debit or a credit on
 * an account of this class. A caller sets one side: a debit that is not
 * positive falls through to the credit side, so `(-5, 0)` stores a credit of
 * 0, not a credit of 5.
 */
export function toStoredAmount(
  debitAmount: number,
  creditAmount: number,
  accountClass: AccountClass
): number {
  const type = accountClass.toLowerCase() as AccountType;
  if (debitAmount > 0) return debit(type, debitAmount);
  return credit(type, creditAmount);
}
