type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

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

// glAccountClass (Asset|Liability|Equity|Revenue|Expense) → the lowercase
// AccountType the debit/credit helpers expect. Shared by the payment and memo
// journal builders so a line's natural-balance sign follows the account's class.
export const accountTypeFromClass = (glClass: string): AccountType => {
  switch (glClass) {
    case "Asset":
      return "asset";
    case "Liability":
      return "liability";
    case "Equity":
      return "equity";
    case "Revenue":
      return "revenue";
    case "Expense":
      return "expense";
    default:
      throw new Error(`Unknown GL account class: ${glClass}`);
  }
};
