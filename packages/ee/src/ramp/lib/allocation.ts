import { distributeRoundingResidual, round } from "@carbon/utils";

/** A card-transaction line to be scaled for a partial repayment. */
export type RepaymentLineInput = {
  accountId: string;
  amount: number;
  costCenterId?: string | null;
  description?: string | null;
};

export type ScaledRepaymentLine = {
  accountId: string;
  amount: number;
  costCenterId: string | null;
  description: string | null;
};

function validateAllocationInputs(
  amounts: number[],
  target: number,
  decimals: number
) {
  if (
    !Number.isFinite(target) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    amounts.some((amount) => !Number.isFinite(amount))
  ) {
    throw new Error("Allocation inputs must be finite");
  }

  const roundedTarget = round(target, decimals);
  if (amounts.length === 0 && roundedTarget !== 0) {
    throw new Error("Cannot allocate a nonzero target without source lines");
  }

  return roundedTarget;
}

/** Scale lines proportionally while keeping every rounding correction bounded. */
export function scaleLinesToTotal<T extends { amount: number }>(
  lines: T[],
  target: number,
  decimals: number
): T[] {
  const roundedTarget = validateAllocationInputs(
    lines.map((line) => line.amount),
    target,
    decimals
  );
  if (lines.length === 0) return [];

  const rawSum = lines.reduce((sum, line) => sum + line.amount, 0);
  if (rawSum === 0) {
    if (roundedTarget !== 0) {
      throw new Error(
        "Cannot allocate a nonzero target from a zero source total"
      );
    }
    return lines.map((line) => ({ ...line, amount: 0 }));
  }

  const ratio = target / rawSum;
  const amounts = distributeRoundingResidual(
    lines.map((line) => line.amount * ratio),
    roundedTarget,
    decimals
  );

  return lines.map((line, index) => ({
    ...line,
    amount: amounts[index]!
  }));
}

/** Scale original coding lines to a repayment using the canonical allocator. */
export function scaleRepaymentLines(
  originalLines: RepaymentLineInput[],
  repaymentAmount: number,
  originalAmount: number,
  decimals: number
): ScaledRepaymentLine[] {
  const roundedTarget = validateAllocationInputs(
    originalLines.map((line) => line.amount),
    repaymentAmount,
    decimals
  );
  if (!Number.isFinite(originalAmount)) {
    throw new Error("Allocation inputs must be finite");
  }
  if (originalLines.length === 0) return [];

  if (originalAmount === 0) {
    if (roundedTarget !== 0) {
      throw new Error(
        "Cannot allocate a nonzero target from a zero source total"
      );
    }
    return originalLines.map((line) => ({
      accountId: line.accountId,
      amount: 0,
      costCenterId: line.costCenterId ?? null,
      description: line.description ?? null
    }));
  }

  const ratio = repaymentAmount / originalAmount;
  const amounts = distributeRoundingResidual(
    originalLines.map((line) => line.amount * ratio),
    roundedTarget,
    decimals
  );

  return originalLines.map((line, index) => ({
    accountId: line.accountId,
    amount: amounts[index]!,
    costCenterId: line.costCenterId ?? null,
    description: line.description ?? null
  }));
}
