// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// R&D tax rules: the work country class (§174A domestic or foreign), the tax
// year, funded research, wage QREs with the "substantially all" rule, and the
// Form 6765 Section G rows. Pure, so the reports and their tests agree.
// Spec: `.ai/specs/2026-10-09-government-contracting.md` (Phase 5d)

import type { Database } from "@carbon/database";
import { round } from "@carbon/database/precision";
import { CalendarDate } from "@internationalized/date";

export type RdActivityRole = Database["public"]["Enums"]["rdActivityRole"];

/**
 * The United States, Puerto Rico and the US possessions. IRC §41(d)(4)(F)
 * defines foreign research as research outside these (decision D1).
 */
export const DOMESTIC_COUNTRY_CODES = [
  "US",
  "PR",
  "GU",
  "VI",
  "AS",
  "MP",
  "UM"
] as const;

const DOMESTIC = new Set<string>(DOMESTIC_COUNTRY_CODES);

/** Share of an employee's hours that makes all of the wages qualified. */
export const SUBSTANTIALLY_ALL_SHARE = 0.8;
/** Share of contract research that counts as a QRE (§41(b)(3)). */
export const CONTRACT_RESEARCH_SHARE = 0.65;
/** Section G lists at most this many business components. */
export const SECTION_G_MAX_ROWS = 50;
/** Section G lists components until they hold this share of the total. */
export const SECTION_G_MIN_SHARE = 0.8;

export type WorkCountryClass = "Domestic" | "Foreign" | "Unknown";

/** No country gives Unknown; a US code gives Domestic; any other, Foreign. */
export function workCountryClass(countryCode: string | null): WorkCountryClass {
  if (!countryCode) return "Unknown";
  return DOMESTIC.has(countryCode.toUpperCase()) ? "Domestic" : "Foreign";
}

/**
 * The tax year that starts in `startMonth` of `year` (decision D9): twelve
 * months, as `YYYY-MM-DD` dates.
 */
export function taxYearBounds(
  year: number,
  startMonth: number
): { from: string; to: string } {
  const from = new CalendarDate(year, startMonth, 1);
  const to = from.add({ years: 1 }).subtract({ days: 1 });
  return { from: from.toString(), to: to.toString() };
}

/**
 * A contract's stored flag when it is set, else true when the contract has a
 * Cost Plus or Time & Materials line (decision D10).
 */
export function isFundedResearch(contract: {
  researchFunded: boolean | null;
  hasCostPlusOrTimeAndMaterialsLine: boolean;
}): boolean {
  return contract.researchFunded ?? contract.hasCostPlusOrTimeAndMaterialsLine;
}

export type QualifiedHours = {
  componentId: string;
  role: Exclude<RdActivityRole, "Not Qualified">;
  hours: number;
};

export type ComponentWageQres = {
  research: number;
  supervision: number;
  support: number;
};

const ROLE_FIELD: Record<QualifiedHours["role"], keyof ComponentWageQres> = {
  "Direct Research": "research",
  "Direct Supervision": "supervision",
  "Direct Support": "support"
};

/**
 * Wage QREs per business component and role. An employee whose qualified
 * hours are 80 % or more of their total hours qualifies all of the wages;
 * otherwise the qualified share. The qualified wages spread over the
 * (component, role) pairs by hours.
 */
export function wageQres(
  employees: {
    employeeId: string;
    wages: number;
    totalHours: number;
    isOfficer: boolean;
    qualified: QualifiedHours[];
  }[]
): {
  byComponent: Record<string, ComponentWageQres>;
  officerWages: number;
} {
  const byComponent: Record<string, ComponentWageQres> = {};
  let officerWages = 0;

  for (const employee of employees) {
    const qualifiedHours = employee.qualified.reduce(
      (sum, q) => sum + q.hours,
      0
    );
    if (employee.totalHours <= 0 || qualifiedHours <= 0) continue;

    const share = qualifiedHours / employee.totalHours;
    const qualifiedWages = round(
      share >= SUBSTANTIALLY_ALL_SHARE ? employee.wages : employee.wages * share
    );

    for (const q of employee.qualified) {
      if (q.hours === 0) continue;
      const component = (byComponent[q.componentId] ??= {
        research: 0,
        supervision: 0,
        support: 0
      });
      const field = ROLE_FIELD[q.role];
      component[field] = round(
        component[field] + round((qualifiedWages * q.hours) / qualifiedHours)
      );
    }

    if (employee.isOfficer) {
      officerWages = round(officerWages + qualifiedWages);
    }
  }

  return { byComponent, officerWages };
}

export type Section6765Input = {
  componentId: string;
  name: string;
  componentType: string | null;
  softwareType: string | null;
  research: number;
  supervision: number;
  support: number;
  supplies: number;
  computerRental: number;
  /** Contract research at 100 %; the row's QRE takes 65 % of it. */
  contractResearch: number;
};

export type Section6765Row = Section6765Input & {
  wageTotal: number;
  contractResearchQre: number;
  total: number;
  isAggregate: boolean;
};

function toRow(component: Section6765Input): Section6765Row {
  const wageTotal = round(
    component.research + component.supervision + component.support
  );
  const contractResearchQre = round(
    component.contractResearch * CONTRACT_RESEARCH_SHARE
  );
  return {
    ...component,
    wageTotal,
    contractResearchQre,
    total: round(
      wageTotal +
        component.supplies +
        component.computerRental +
        contractResearchQre
    ),
    isAggregate: false
  };
}

/**
 * The Form 6765 Section G rows: business components in descending QRE
 * order, listed while fewer than 50 are listed and the listed total is
 * below 80 % of the grand total. The rest sum into one aggregate row.
 */
export function section6765Rows(
  components: Section6765Input[]
): Section6765Row[] {
  const rows = components
    .map(toRow)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);

  const listed: Section6765Row[] = [];
  let listedTotal = 0;
  for (const row of rows) {
    if (
      listed.length >= SECTION_G_MAX_ROWS ||
      listedTotal >= grandTotal * SECTION_G_MIN_SHARE
    ) {
      break;
    }
    listed.push(row);
    listedTotal += row.total;
  }

  const rest = rows.slice(listed.length);
  if (rest.length === 0) return listed;

  const sum = (field: keyof Section6765Row) =>
    round(rest.reduce((total, row) => total + (row[field] as number), 0));

  return [
    ...listed,
    {
      componentId: "",
      name: `All other business components (${rest.length})`,
      componentType: null,
      softwareType: null,
      research: sum("research"),
      supervision: sum("supervision"),
      support: sum("support"),
      supplies: sum("supplies"),
      computerRental: sum("computerRental"),
      contractResearch: sum("contractResearch"),
      wageTotal: sum("wageTotal"),
      contractResearchQre: sum("contractResearchQre"),
      total: sum("total"),
      isAggregate: true
    }
  ];
}
