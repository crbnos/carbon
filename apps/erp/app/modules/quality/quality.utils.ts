// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { type CalendarDate, parseDate } from "@internationalized/date";
import { niceAxis } from "~/utils/chart";
import type { FeatureSamplingRule } from "./samplingStandards";

/**
 * The issue type a receipt inspection lot's NCR opens with: one for supplier or
 * receiving problems, else the first.
 */
export function receiptLotIssueType<Type extends { id: string; name: string }>(
  types: readonly Type[] | null | undefined
): Type | undefined {
  const list = types ?? [];
  return (
    list.find((type) =>
      /supplier|vendor|receiv|incoming|goods.in/i.test(type.name)
    ) ?? list[0]
  );
}

/**
 * An issue workflow's required action ids, in order and without repeats. A
 * string is read as the workflow form sends it (a JSON list), as a Postgres
 * array literal (`{a,b}`) or as comma-separated ids. Null when a JSON list
 * does not parse.
 */
export function requiredActionIdList(
  value: readonly string[] | string
): string[] | null {
  if (typeof value !== "string") return uniqueIds(value);
  const text = value.trim();
  if (text.startsWith("[")) return jsonIdList(text);
  return uniqueIds(arrayLiteralItems(text));
}

function uniqueIds(ids: readonly unknown[]): string[] {
  return [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
}

function jsonIdList(text: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? uniqueIds(parsed) : null;
  } catch {
    return null;
  }
}

/** The items of a Postgres array literal (`{a,"b"}`) or of a comma-separated list. */
function arrayLiteralItems(text: string): string[] {
  const inner =
    text.startsWith("{") && text.endsWith("}") ? text.slice(1, -1) : text;
  return inner.split(",").map((item) => unquoted(item.trim()));
}

function unquoted(text: string): string {
  const quoted = text.length > 1 && text.startsWith('"') && text.endsWith('"');
  return quoted ? text.slice(1, -1) : text;
}

/**
 * A sampling rule as the sampling form saves it: each value is kept only for
 * the plan type that uses it (sample size for First, percentage for
 * Percentage, AQL, inspection level and severity for AQL), the rest are null.
 * A missing value is null; the sampling engine reads a null AQL value, level
 * and severity as 1.0, II and Normal, as the form preselects them.
 */
export function samplingRuleForPlanType(rule: FeatureSamplingRule): {
  [K in keyof FeatureSamplingRule]-?: Exclude<
    FeatureSamplingRule[K],
    undefined
  >;
} {
  const type = rule.samplingPlanType ?? null;
  const aql = type === "AQL";
  return {
    samplingPlanType: type,
    samplingSampleSize:
      type === "First" ? (rule.samplingSampleSize ?? null) : null,
    samplingPercentage:
      type === "Percentage" ? (rule.samplingPercentage ?? null) : null,
    samplingAql: aql ? (rule.samplingAql ?? null) : null,
    samplingInspectionLevel: aql
      ? (rule.samplingInspectionLevel ?? null)
      : null,
    samplingSeverity: aql ? (rule.samplingSeverity ?? null) : null
  };
}

/**
 * A calibration's result as the calibration form decides it: Fail when it
 * requires action, adjustment or repair, else Pass.
 */
export function calibrationInspectionStatus(record: {
  requiresAction?: boolean;
  requiresAdjustment?: boolean;
  requiresRepair?: boolean;
}): "Pass" | "Fail" {
  return record.requiresAction ||
    record.requiresAdjustment ||
    record.requiresRepair
    ? "Fail"
    : "Pass";
}

/**
 * A calibration's flags and the result they decide, as the form saves them: a
 * flag left out is false, as an unticked box.
 */
export function calibrationFlags(record: {
  requiresAction?: boolean;
  requiresAdjustment?: boolean;
  requiresRepair?: boolean;
}) {
  const flags = {
    requiresAction: record.requiresAction ?? false,
    requiresAdjustment: record.requiresAdjustment ?? false,
    requiresRepair: record.requiresRepair ?? false
  };
  return { ...flags, inspectionStatus: calibrationInspectionStatus(flags) };
}

/**
 * Why a calibration's sent `inspectionStatus` is refused: the form has no such
 * field and decides it from the flags, so a sent one must agree with them.
 * Null when it agrees or none was sent.
 */
export function calibrationInspectionStatusRefusal(record: {
  requiresAction?: boolean;
  requiresAdjustment?: boolean;
  requiresRepair?: boolean;
  inspectionStatus?: "Pass" | "Fail";
}): string | null {
  const decided = calibrationInspectionStatus(record);
  if (!record.inspectionStatus || record.inspectionStatus === decided) {
    return null;
  }
  return decided === "Fail"
    ? "A calibration that requires action, adjustment or repair is a Fail. Leave out inspectionStatus, or send Fail"
    : "A calibration that requires no action, adjustment or repair is a Pass. Leave out inspectionStatus, or send Pass";
}

/**
 * The order an inspection plan's characteristics are shown in: by
 * `createdAt`, then by label (natural, so 2 comes before 10), then by id.
 * Characteristics saved together can share a `createdAt`. `createdAt` is
 * compared as text, so it must keep its microseconds.
 */
export function compareInspectionFeatures(
  a: { createdAt?: string | null; label?: string | null; id: string },
  b: { createdAt?: string | null; label?: string | null; id: string }
): number {
  return (
    compareText(a.createdAt ?? "", b.createdAt ?? "") ||
    (a.label ?? "").localeCompare(b.label ?? "", undefined, {
      numeric: true
    }) ||
    a.id.localeCompare(b.id)
  );
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * A gauge's calibration status as the gauge form derives it from its dates:
 * Pending without a next calibration date, Out-of-Calibration once that date
 * has passed, else In-Calibration when it has a last calibration date, else
 * Pending.
 */
export function gaugeCalibrationStatusFromDates(
  dates: {
    lastCalibrationDate?: string | null;
    nextCalibrationDate?: string | null;
  },
  today: CalendarDate
): "Pending" | "In-Calibration" | "Out-of-Calibration" {
  if (!dates.nextCalibrationDate) return "Pending";
  if (parseDate(dates.nextCalibrationDate).compare(today) < 0) {
    return "Out-of-Calibration";
  }
  return dates.lastCalibrationDate ? "In-Calibration" : "Pending";
}
type Tables = Database["public"]["Tables"];

export type ScarIssue = Pick<
  Tables["nonConformance"]["Row"],
  "nonConformanceId" | "name" | "status"
>;

export type ScarActionTask = Pick<
  Tables["nonConformanceActionTask"]["Row"],
  "id" | "status" | "supplierId" | "notes"
> & { name?: string | null };

export type ScarCompany = Pick<
  Tables["company"]["Row"],
  "name" | "logoLight" | "logoDark"
>;

/**
 * What a SCAR link sends the logged-out supplier: the issue's number, name and
 * status, and the supplier's own action tasks. The issue's description,
 * dispositions, assignees and integration links stay internal.
 */
export function scarForSupplier({
  issue,
  company,
  supplier,
  actionTasks
}: {
  issue: ScarIssue;
  company: ScarCompany | null;
  supplier: { name: string | null } | null;
  actionTasks: ScarActionTask[];
}): {
  issue: ScarIssue;
  company: ScarCompany | null;
  supplier: { name: string | null } | null;
  actionTasks: ScarActionTask[];
} {
  return {
    issue: {
      nonConformanceId: issue.nonConformanceId,
      name: issue.name,
      status: issue.status
    },
    company: company
      ? {
          name: company.name,
          logoLight: company.logoLight,
          logoDark: company.logoDark
        }
      : null,
    supplier: supplier ? { name: supplier.name } : null,
    actionTasks: actionTasks.map((task) => ({
      id: task.id,
      name: task.name ?? null,
      status: task.status,
      supplierId: task.supplierId,
      notes: task.notes
    }))
  };
}

export type IssueTrendSeries = "opened" | "closed" | "target";

/**
 * The Issue Trend chart's Y axis, from 0 to the busiest week or the issue
 * target, whichever is higher. Recharts drops a reference line outside the
 * axis, so an axis fitted to the weeks alone hides a target above them.
 * A series the legend hides is left out, so hiding the target fits the axis
 * to the weeks.
 * `showCounts`: every bar is at most a quarter of the axis, too short to read
 * against the gridlines, so the bars print their counts.
 */
export function issueTrendAxis(
  weeks: readonly { opened?: number; closed?: number }[],
  target: number | null | undefined,
  hidden: { has(series: IssueTrendSeries): boolean } = new Set()
) {
  const busiestWeek = weeks.reduce(
    (max, week) =>
      Math.max(
        max,
        hidden.has("opened") ? 0 : (week.opened ?? 0),
        hidden.has("closed") ? 0 : (week.closed ?? 0)
      ),
    0
  );
  const shownTarget = hidden.has("target") ? 0 : (target ?? 0);
  const axis = niceAxis(0, Math.max(busiestWeek, shownTarget), 5);
  return {
    ...axis,
    showCounts: busiestWeek > 0 && busiestWeek * 4 <= axis.niceMax
  };
}
