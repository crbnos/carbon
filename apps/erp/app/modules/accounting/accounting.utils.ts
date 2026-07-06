export const macrsPropertyClasses = [
  "3",
  "5",
  "7",
  "10",
  "15",
  "20",
  "27.5",
  "39"
] as const;

export const macrsConventions = ["Half-Year", "Mid-Quarter"] as const;

export type MacrsPropertyClass = (typeof macrsPropertyClasses)[number];
export type MacrsConvention = (typeof macrsConventions)[number];

// IRS Revenue Procedure 87-57, Table 1 (GDS, Half-Year Convention)
const MACRS_HALF_YEAR: Record<string, number[]> = {
  "3": [33.33, 44.45, 14.81, 7.41],
  "5": [20.0, 32.0, 19.2, 11.52, 11.52, 5.76],
  "7": [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  "10": [10.0, 18.0, 14.4, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
  "15": [
    5.0, 9.5, 8.55, 7.7, 6.93, 6.23, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9,
    5.91, 2.95
  ],
  "20": [
    3.75, 7.219, 6.677, 6.177, 5.713, 5.285, 4.888, 4.522, 4.462, 4.461, 4.462,
    4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 2.231
  ]
};

// IRS Tables 2-5 (GDS, Mid-Quarter Convention)
const MACRS_MID_QUARTER: Record<string, Record<number, number[]>> = {
  "3": {
    1: [58.33, 27.78, 12.35, 1.54],
    2: [41.67, 38.89, 14.14, 5.3],
    3: [25.0, 50.0, 16.67, 8.33],
    4: [8.33, 61.11, 20.37, 10.19]
  },
  "5": {
    1: [35.0, 26.0, 15.6, 11.01, 11.01, 1.38],
    2: [25.0, 30.0, 18.0, 11.37, 11.37, 4.26],
    3: [15.0, 34.0, 20.4, 12.24, 11.3, 7.06],
    4: [5.0, 38.0, 22.8, 13.68, 10.94, 9.58]
  },
  "7": {
    1: [25.0, 21.43, 15.31, 10.93, 8.75, 8.74, 8.75, 1.09],
    2: [17.85, 23.47, 16.76, 11.97, 8.87, 8.87, 8.87, 3.34],
    3: [10.71, 25.51, 18.22, 13.02, 9.3, 8.85, 8.86, 5.53],
    4: [3.57, 27.55, 19.68, 14.06, 10.04, 8.73, 8.73, 7.64]
  },
  "10": {
    1: [17.5, 16.5, 13.2, 10.56, 8.45, 6.76, 6.55, 6.55, 6.56, 6.55, 0.82],
    2: [12.5, 17.5, 14.0, 11.2, 8.96, 7.17, 6.55, 6.55, 6.56, 6.55, 2.46],
    3: [7.5, 18.5, 14.8, 11.84, 9.47, 7.58, 6.55, 6.55, 6.56, 6.55, 4.1],
    4: [2.5, 19.5, 15.6, 12.48, 9.98, 7.99, 6.55, 6.55, 6.56, 6.55, 5.74]
  },
  "15": {
    1: [
      8.75, 9.13, 8.21, 7.39, 6.65, 5.99, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 0.74
    ],
    2: [
      6.25, 9.38, 8.44, 7.59, 6.83, 6.15, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 2.21
    ],
    3: [
      3.75, 9.63, 8.66, 7.8, 7.02, 6.31, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 3.69
    ],
    4: [
      1.25, 9.88, 8.89, 8.0, 7.2, 6.48, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 5.17
    ]
  },
  "20": {
    1: [
      6.563, 7.0, 6.482, 5.996, 5.546, 5.13, 4.746, 4.459, 4.459, 4.459, 4.459,
      4.46, 4.459, 4.46, 4.459, 4.46, 4.459, 4.46, 4.459, 4.46, 0.557
    ],
    2: [
      4.688, 7.148, 6.612, 6.116, 5.658, 5.233, 4.841, 4.478, 4.463, 4.463,
      4.463, 4.463, 4.463, 4.463, 4.463, 4.462, 4.463, 4.462, 4.463, 4.462,
      1.673
    ],
    3: [
      2.813, 7.289, 6.742, 6.237, 5.769, 5.336, 4.936, 4.566, 4.46, 4.46, 4.46,
      4.461, 4.46, 4.461, 4.46, 4.461, 4.46, 4.461, 4.46, 4.461, 2.788
    ],
    4: [
      0.938, 7.43, 6.872, 6.357, 5.88, 5.439, 5.031, 4.654, 4.458, 4.458, 4.458,
      4.458, 4.458, 4.458, 4.458, 4.458, 4.458, 4.458, 4.459, 4.458, 3.901
    ]
  }
};

export function getMacrsPercentage(
  propertyClass: MacrsPropertyClass,
  yearInService: number,
  convention: MacrsConvention,
  quarterPlacedInService?: number
): number | null {
  if (propertyClass === "27.5" || propertyClass === "39") {
    return null;
  }

  const yearIndex = yearInService - 1;

  if (convention === "Half-Year") {
    const table = MACRS_HALF_YEAR[propertyClass];
    if (!table || yearIndex >= table.length) return 0;
    return table[yearIndex];
  }

  const quarter = quarterPlacedInService ?? 1;
  const classTable = MACRS_MID_QUARTER[propertyClass];
  if (!classTable) return 0;
  const table = classTable[quarter];
  if (!table || yearIndex >= table.length) return 0;
  return table[yearIndex];
}

export function calculateMacrsDepreciation(args: {
  adjustedBasis: number;
  propertyClass: MacrsPropertyClass;
  convention: MacrsConvention;
  depreciationStartDate: string;
  periodEnd: string;
  lastPostedPeriodEnd: string | null;
  accumulatedTaxDepreciation: number;
  bonusAmount: number;
}): number {
  const {
    adjustedBasis,
    propertyClass,
    convention,
    depreciationStartDate,
    periodEnd,
    lastPostedPeriodEnd,
    accumulatedTaxDepreciation,
    bonusAmount
  } = args;

  if (adjustedBasis <= 0) return 0;

  const startDate = new Date(depreciationStartDate);
  const periodEndDate = new Date(periodEnd);
  const fromDate = lastPostedPeriodEnd
    ? new Date(lastPostedPeriodEnd)
    : startDate;

  // 27.5 and 39-year property: straight-line with mid-month convention
  if (propertyClass === "27.5" || propertyClass === "39") {
    const lifeMonths = propertyClass === "27.5" ? 27.5 * 12 : 39 * 12;
    const monthlyAmount = adjustedBasis / lifeMonths;
    const monthsElapsed =
      (periodEndDate.getFullYear() - fromDate.getFullYear()) * 12 +
      (periodEndDate.getMonth() - fromDate.getMonth());
    const months = lastPostedPeriodEnd ? monthsElapsed : monthsElapsed + 0.5;
    const amount = monthlyAmount * Math.max(0, months);
    const remaining =
      adjustedBasis - (accumulatedTaxDepreciation - bonusAmount);
    return Math.min(Math.round(amount * 100) / 100, Math.max(0, remaining));
  }

  // Table-based MACRS: compute cumulative depreciation through periodEnd,
  // then subtract what has already been taken (accumulatedTaxDepreciation - bonusAmount).
  // MACRS years are calendar years. The IRS percentages already incorporate the
  // convention (half-year or mid-quarter), so year 1 = the full first calendar year amount.
  // Year 1 is spread across months from placed-in-service through Dec 31.
  // Subsequent years are spread evenly across 12 calendar months.
  const quarterPlaced = Math.ceil((startDate.getMonth() + 1) / 3);
  const startYear = startDate.getFullYear();
  const periodEndYear = periodEndDate.getFullYear();
  const lastYearToCalc = periodEndYear - startYear + 1;
  const startMonth = startDate.getMonth(); // 0-based

  let cumulativeThrough = 0;

  for (let year = 1; year <= lastYearToCalc; year++) {
    const pct = getMacrsPercentage(
      propertyClass,
      year,
      convention,
      quarterPlaced
    );
    if (pct === null || pct === 0) continue;

    const annualAmount = adjustedBasis * (pct / 100);
    const totalMonthsInYear = year === 1 ? 12 - startMonth : 12;
    const monthlyAmount = annualAmount / totalMonthsInYear;

    if (year < lastYearToCalc) {
      cumulativeThrough += annualAmount;
    } else {
      // Count months from the start of this MACRS year through periodEnd
      const yearStartMonth = year === 1 ? startMonth : 0;
      const calendarYear = startYear + year - 1;
      const periodEndMonth =
        periodEndDate.getFullYear() === calendarYear
          ? periodEndDate.getMonth()
          : 11;

      const monthsElapsed = periodEndMonth - yearStartMonth + 1;
      cumulativeThrough +=
        monthlyAmount * Math.min(monthsElapsed, totalMonthsInYear);
    }
  }

  const alreadyTaken = accumulatedTaxDepreciation - bonusAmount;
  const periodAmount = cumulativeThrough - Math.max(0, alreadyTaken);
  const remaining = adjustedBasis - Math.max(0, alreadyTaken);
  return Math.min(
    Math.round(Math.max(0, periodAmount) * 100) / 100,
    Math.max(0, remaining)
  );
}

export type DepreciationLine = {
  fixedAssetId: string;
  amount: number;
  taxAmount: number | null;
};

export function getMonthsBetween(start: Date, end: Date): number {
  const years = end.getFullYear() - start.getFullYear();
  const months = end.getMonth() - start.getMonth();
  let total = years * 12 + months;
  if (end.getDate() >= start.getDate()) total += 1;
  return Math.max(0, total);
}

export function getMonthsElapsed(start: Date, end: Date): number {
  const years = end.getFullYear() - start.getFullYear();
  const months = end.getMonth() - start.getMonth();
  return Math.max(0, years * 12 + months);
}

export function addOneMonth(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  return d;
}

export function getLastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month + 1, 0);
  return d.toISOString().split("T")[0];
}

export function getNextPeriodEnd(lastPeriodEnd: string | null): string {
  if (lastPeriodEnd) {
    const last = new Date(lastPeriodEnd);
    const nextMonth = last.getMonth() + 1;
    const nextYear = last.getFullYear() + (nextMonth > 11 ? 1 : 0);
    return getLastDayOfMonth(nextYear, nextMonth % 12);
  }
  const now = new Date();
  return getLastDayOfMonth(now.getFullYear(), now.getMonth());
}

export function calculateDepreciation(
  asset: {
    acquisitionCost: number;
    accumulatedDepreciation: number;
    residualValuePercent: number;
    depreciationMethod: string;
    usefulLifeMonths: number;
    depreciationStartDate: string | null;
    acquisitionDate: string | null;
    assetLifetimeUsage: number | null;
  },
  periodEnd: string,
  lastPostedPeriodEnd: string | null,
  usageLog?: { unitsProduced: number }
): number {
  const cost = Number(asset.acquisitionCost);
  const residualValue = cost * (Number(asset.residualValuePercent) / 100);
  const depreciableBase = cost - residualValue;
  const accumulated = Number(asset.accumulatedDepreciation);
  const remainingDepreciable = depreciableBase - accumulated;

  if (remainingDepreciable <= 0) return 0;

  const periodEndDate = new Date(periodEnd);
  const startDate = new Date(
    asset.depreciationStartDate ?? asset.acquisitionDate!
  );

  if (startDate > periodEndDate) return 0;

  switch (asset.depreciationMethod) {
    case "Straight Line": {
      const monthlyAmount = depreciableBase / asset.usefulLifeMonths;
      const from = lastPostedPeriodEnd
        ? addOneMonth(lastPostedPeriodEnd)
        : startDate;
      const monthsToDepreciate = getMonthsBetween(from, periodEndDate);
      const amount = monthlyAmount * monthsToDepreciate;
      return Math.min(Math.round(amount * 100) / 100, remainingDepreciable);
    }
    case "Declining Balance": {
      const annualRate = (1 / (asset.usefulLifeMonths / 12)) * 2;
      const monthlyRate = annualRate / 12;
      const from = lastPostedPeriodEnd
        ? addOneMonth(lastPostedPeriodEnd)
        : startDate;
      const monthsToDepreciate = getMonthsBetween(from, periodEndDate);
      let totalDepr = 0;
      let nbv = cost - accumulated;
      for (let i = 0; i < monthsToDepreciate; i++) {
        const dbAmount = nbv * monthlyRate;
        const remainingMonths = Math.max(
          1,
          asset.usefulLifeMonths -
            getMonthsElapsed(startDate, periodEndDate) +
            monthsToDepreciate -
            i
        );
        const slAmount = (nbv - residualValue) / remainingMonths;
        const amount = Math.max(dbAmount, slAmount);
        const capped = Math.min(amount, nbv - residualValue);
        if (capped <= 0) break;
        totalDepr += capped;
        nbv -= capped;
      }
      return Math.min(Math.round(totalDepr * 100) / 100, remainingDepreciable);
    }
    case "Units of Production": {
      if (
        !usageLog ||
        !asset.assetLifetimeUsage ||
        Number(asset.assetLifetimeUsage) <= 0
      )
        return 0;
      const ratePerUnit = depreciableBase / Number(asset.assetLifetimeUsage);
      const amount = ratePerUnit * usageLog.unitsProduced;
      return Math.min(Math.round(amount * 100) / 100, remainingDepreciable);
    }
    default:
      return 0;
  }
}

export function calculateTaxDepreciation(
  asset: {
    acquisitionCost: number;
    accumulatedTaxDepreciation: number;
    depreciationStartDate: string | null;
    acquisitionDate: string | null;
    taxDepreciationMethod: string | null;
    taxUsefulLifeMonths: number | null;
    taxResidualValuePercent: number | null;
    macrsPropertyClass: string | null;
    macrsConvention: string | null;
    bonusDepreciationPercent: number | null;
  },
  periodEnd: string,
  lastPostedPeriodEnd: string | null
): number | null {
  const taxMethod = asset.taxDepreciationMethod;
  if (!taxMethod) return null;

  const cost = Number(asset.acquisitionCost);
  const accumulatedTax = Number(asset.accumulatedTaxDepreciation);
  const startDate = asset.depreciationStartDate ?? asset.acquisitionDate!;

  if (taxMethod === "MACRS") {
    const propertyClass = asset.macrsPropertyClass! as MacrsPropertyClass;
    const convention = (asset.macrsConvention ??
      "Half-Year") as MacrsConvention;
    const bonusPct = Number(asset.bonusDepreciationPercent ?? 0);
    const bonusAmount = cost * (bonusPct / 100);
    const adjustedBasis = cost - bonusAmount;

    let bonus = 0;
    if (accumulatedTax === 0 && bonusAmount > 0) {
      bonus = bonusAmount;
    }

    const macrsAmount = calculateMacrsDepreciation({
      adjustedBasis,
      propertyClass,
      convention,
      depreciationStartDate: startDate,
      periodEnd,
      lastPostedPeriodEnd,
      accumulatedTaxDepreciation: accumulatedTax,
      bonusAmount
    });

    return Math.round((bonus + macrsAmount) * 100) / 100;
  }

  const taxLife = asset.taxUsefulLifeMonths!;
  const taxResidualPct = Number(asset.taxResidualValuePercent ?? 0);
  const residualValue = cost * (taxResidualPct / 100);
  const depreciableBase = cost - residualValue;
  const remainingDepreciable = depreciableBase - accumulatedTax;

  if (remainingDepreciable <= 0) return 0;

  const periodEndDate = new Date(periodEnd);
  const depStartDate = new Date(startDate);

  if (depStartDate > periodEndDate) return 0;

  const from = lastPostedPeriodEnd
    ? addOneMonth(lastPostedPeriodEnd)
    : depStartDate;
  const monthsToDepreciate = getMonthsBetween(from, periodEndDate);

  if (taxMethod === "Straight Line") {
    const monthlyAmount = depreciableBase / taxLife;
    const amount = monthlyAmount * monthsToDepreciate;
    return Math.min(Math.round(amount * 100) / 100, remainingDepreciable);
  }

  if (taxMethod === "Declining Balance") {
    const annualRate = (1 / (taxLife / 12)) * 2;
    const monthlyRate = annualRate / 12;
    let totalDepr = 0;
    let nbv = cost - accumulatedTax;
    for (let i = 0; i < monthsToDepreciate; i++) {
      const dbAmount = nbv * monthlyRate;
      const remainingMonths = Math.max(
        1,
        taxLife -
          getMonthsElapsed(depStartDate, periodEndDate) +
          monthsToDepreciate -
          i
      );
      const slAmount = (nbv - residualValue) / remainingMonths;
      const amount = Math.max(dbAmount, slAmount);
      const capped = Math.min(amount, nbv - residualValue);
      if (capped <= 0) break;
      totalDepr += capped;
      nbv -= capped;
    }
    return Math.min(Math.round(totalDepr * 100) / 100, remainingDepreciable);
  }

  return null;
}

export function buildDepreciationLines(
  assets: Array<{
    id: string;
    acquisitionCost: number;
    accumulatedDepreciation: number;
    residualValuePercent: number;
    depreciationMethod: string;
    usefulLifeMonths: number;
    depreciationStartDate: string | null;
    acquisitionDate: string | null;
    assetLifetimeUsage: number | null;
    accumulatedTaxDepreciation?: number;
    taxDepreciationMethod: string | null;
    taxUsefulLifeMonths: number | null;
    taxResidualValuePercent: number | null;
    macrsPropertyClass: string | null;
    macrsConvention: string | null;
    bonusDepreciationPercent: number | null;
  }>,
  periodEnd: string,
  lastPostedPeriodEnd: string | null,
  taxEnabled: boolean,
  usageMap: Map<string, { unitsProduced: number }>
): DepreciationLine[] {
  const lines: DepreciationLine[] = [];

  for (const asset of assets) {
    const usageLog = usageMap.get(asset.id);
    const amount = calculateDepreciation(
      {
        acquisitionCost: Number(asset.acquisitionCost),
        accumulatedDepreciation: Number(asset.accumulatedDepreciation),
        residualValuePercent: Number(asset.residualValuePercent),
        depreciationMethod: asset.depreciationMethod,
        usefulLifeMonths: asset.usefulLifeMonths,
        depreciationStartDate: asset.depreciationStartDate,
        acquisitionDate: asset.acquisitionDate,
        assetLifetimeUsage: asset.assetLifetimeUsage
          ? Number(asset.assetLifetimeUsage)
          : null
      },
      periodEnd,
      lastPostedPeriodEnd,
      usageLog
    );

    let taxAmount: number | null = null;
    if (taxEnabled) {
      taxAmount = calculateTaxDepreciation(
        {
          acquisitionCost: Number(asset.acquisitionCost),
          accumulatedTaxDepreciation: Number(
            asset.accumulatedTaxDepreciation ?? 0
          ),
          depreciationStartDate: asset.depreciationStartDate,
          acquisitionDate: asset.acquisitionDate,
          taxDepreciationMethod: asset.taxDepreciationMethod,
          taxUsefulLifeMonths: asset.taxUsefulLifeMonths,
          taxResidualValuePercent: asset.taxResidualValuePercent,
          macrsPropertyClass: asset.macrsPropertyClass,
          macrsConvention: asset.macrsConvention,
          bonusDepreciationPercent: asset.bonusDepreciationPercent
        },
        periodEnd,
        lastPostedPeriodEnd
      );
      if (taxAmount === null) {
        taxAmount = amount;
      }
    }

    if (amount > 0 || (taxAmount !== null && taxAmount > 0)) {
      lines.push({ fixedAssetId: asset.id, amount, taxAmount });
    }
  }

  return lines;
}
