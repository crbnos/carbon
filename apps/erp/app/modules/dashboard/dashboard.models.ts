import { round } from "@carbon/utils";
import {
  CalendarDate,
  parseDate,
  startOfMonth,
  startOfYear
} from "@internationalized/date";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Time ranges
// ---------------------------------------------------------------------------

export const DASHBOARD_RANGES = [
  "7d",
  "30d",
  "90d",
  "mtd",
  "qtd",
  "ytd",
  "12m"
] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export const DEFAULT_DASHBOARD_RANGE: DashboardRange = "30d";

export function isDashboardRange(value: unknown): value is DashboardRange {
  return (
    typeof value === "string" &&
    (DASHBOARD_RANGES as readonly string[]).includes(value)
  );
}

export type DashboardWindow = {
  /** Inclusive YYYY-MM-DD */
  start: string;
  /** Inclusive YYYY-MM-DD (= today) */
  end: string;
  previousStart: string;
  previousEnd: string;
  bucket: "day" | "month";
};

/** Ranges of this many days or more are bucketed by month in trend widgets. */
const MONTH_BUCKET_THRESHOLD_DAYS = 92;

/**
 * Resolve a preset into an inclusive window ending on `today` (the company's
 * calendar day, YYYY-MM-DD) plus the same-length window immediately before it.
 * Pure calendar arithmetic — no JS Date.
 */
export function resolveDashboardRange(
  range: DashboardRange,
  today: string
): DashboardWindow {
  const end = parseDate(today);
  let start: CalendarDate;
  switch (range) {
    case "7d":
      start = end.subtract({ days: 6 });
      break;
    case "30d":
      start = end.subtract({ days: 29 });
      break;
    case "90d":
      start = end.subtract({ days: 89 });
      break;
    case "mtd":
      start = startOfMonth(end);
      break;
    case "qtd": {
      const quarterStartMonth = end.month - ((end.month - 1) % 3);
      start = new CalendarDate(end.year, quarterStartMonth, 1);
      break;
    }
    case "ytd":
      start = startOfYear(end);
      break;
    case "12m":
      start = end.subtract({ months: 12 }).add({ days: 1 });
      break;
  }
  return windowFromDates(start, end);
}

/** The window for an explicit start/end pair (the widget API's contract). */
export function windowFromDates(
  start: CalendarDate,
  end: CalendarDate
): DashboardWindow {
  const spanDays = end.compare(start); // whole days between, exclusive of end
  const previousEnd = start.subtract({ days: 1 });
  const previousStart = previousEnd.subtract({ days: spanDays });
  return {
    start: start.toString(),
    end: end.toString(),
    previousStart: previousStart.toString(),
    previousEnd: previousEnd.toString(),
    bucket: spanDays + 1 >= MONTH_BUCKET_THRESHOLD_DAYS ? "month" : "day"
  };
}

/** Longest window the widget API will serve, matching the module KPI routes. */
export const MAX_WINDOW_DAYS = 500;

// ---------------------------------------------------------------------------
// Widget registry
// ---------------------------------------------------------------------------

export type WidgetKind = "stat" | "trend" | "breakdown" | "list";
/** sm = 1/3, md = 2/3, lg = full width of the home page's lg:grid-cols-3 grid. */
export type WidgetSize = "sm" | "md" | "lg";
/** Permission module keys as used by `useModules` / `permissions.can("view", …)`. */
export type WidgetModule =
  | "sales"
  | "purchasing"
  | "production"
  | "quality"
  | "invoicing"
  | "inventory"
  | "workflows";
export type WidgetValueKind = "count" | "money" | "percent" | "quantity";

export type WidgetDefinition = {
  /** Stable, module-namespaced slug persisted in userDashboardWidget.widgetKey. */
  key: string;
  module: WidgetModule;
  kind: WidgetKind;
  size: WidgetSize;
  /** Part of the curated first-render subset. */
  defaultVisible: boolean;
  /** false = "as of now" (open counts, aging, inventory value): ignores the range. */
  supportsRange: boolean;
  /** Which direction of change is good — colours the stat delta. */
  goal?: "higher" | "lower";
  /** Formatter kind for stat values. */
  valueKind?: WidgetValueKind;
};

// Registry order is render order. Titles/descriptions live in
// dashboard.labels.ts (Lingui `msg` is a build-time macro and must not be
// imported by vitest / Node — see .ai/lessons.md "Lingui's msg macro").
export const DASHBOARD_WIDGETS = [
  // Sales
  {
    key: "sales.openOrders",
    module: "sales",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: false,
    valueKind: "count"
  },
  {
    key: "sales.openQuotes",
    module: "sales",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: false,
    valueKind: "count"
  },
  {
    key: "sales.revenue",
    module: "sales",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: true,
    goal: "higher",
    valueKind: "money"
  },
  {
    key: "sales.revenueTrend",
    module: "sales",
    kind: "trend",
    size: "md",
    defaultVisible: true,
    supportsRange: true,
    valueKind: "money"
  },
  {
    key: "sales.onTimeDelivery",
    module: "sales",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: true,
    goal: "higher",
    valueKind: "percent"
  },
  {
    key: "sales.openBacklog",
    module: "sales",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: false,
    valueKind: "money"
  },
  {
    key: "sales.assignedToMe",
    module: "sales",
    kind: "list",
    size: "md",
    defaultVisible: false,
    supportsRange: false
  },
  // Purchasing
  {
    key: "purchasing.openOrders",
    module: "purchasing",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: false,
    valueKind: "count"
  },
  {
    key: "purchasing.overdueOrders",
    module: "purchasing",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: false,
    goal: "lower",
    valueKind: "count"
  },
  {
    key: "purchasing.spend",
    module: "purchasing",
    kind: "stat",
    size: "sm",
    defaultVisible: false,
    supportsRange: true,
    valueKind: "money"
  },
  {
    key: "purchasing.spendTrend",
    module: "purchasing",
    kind: "trend",
    size: "md",
    defaultVisible: false,
    supportsRange: true,
    valueKind: "money"
  },
  {
    key: "purchasing.bySupplier",
    module: "purchasing",
    kind: "breakdown",
    size: "md",
    defaultVisible: false,
    supportsRange: true,
    valueKind: "money"
  },
  {
    key: "purchasing.overdueList",
    module: "purchasing",
    kind: "list",
    size: "md",
    defaultVisible: true,
    supportsRange: false
  },
  // Production
  {
    key: "production.activeJobs",
    module: "production",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: false,
    valueKind: "count"
  },
  {
    key: "production.lateJobs",
    module: "production",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: false,
    goal: "lower",
    valueKind: "count"
  },
  {
    key: "production.assignedToMe",
    module: "production",
    kind: "stat",
    size: "sm",
    defaultVisible: false,
    supportsRange: false,
    valueKind: "count"
  },
  {
    key: "production.dueThisWeek",
    module: "production",
    kind: "list",
    size: "md",
    defaultVisible: true,
    supportsRange: false
  },
  {
    key: "production.byStatus",
    module: "production",
    kind: "breakdown",
    size: "md",
    defaultVisible: false,
    supportsRange: false,
    valueKind: "count"
  },
  {
    key: "production.utilization",
    module: "production",
    kind: "breakdown",
    size: "md",
    defaultVisible: false,
    supportsRange: true,
    valueKind: "quantity"
  },
  {
    key: "production.scrapRate",
    module: "production",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: true,
    goal: "lower",
    valueKind: "percent"
  },
  {
    key: "production.firstPassYield",
    module: "production",
    kind: "stat",
    size: "sm",
    defaultVisible: false,
    supportsRange: true,
    goal: "higher",
    valueKind: "percent"
  },
  // Quality
  {
    key: "quality.openIssues",
    module: "quality",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: false,
    goal: "lower",
    valueKind: "count"
  },
  {
    key: "quality.issuesTrend",
    module: "quality",
    kind: "trend",
    size: "md",
    defaultVisible: false,
    supportsRange: true,
    valueKind: "count"
  },
  {
    key: "quality.issuesByType",
    module: "quality",
    kind: "breakdown",
    size: "md",
    defaultVisible: true,
    supportsRange: true,
    valueKind: "count"
  },
  {
    key: "quality.inspectionPassRate",
    module: "quality",
    kind: "stat",
    size: "sm",
    defaultVisible: false,
    supportsRange: true,
    goal: "higher",
    valueKind: "percent"
  },
  // Invoicing
  {
    key: "invoicing.arOutstanding",
    module: "invoicing",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: false,
    valueKind: "money"
  },
  {
    key: "invoicing.arOverdue",
    module: "invoicing",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: false,
    goal: "lower",
    valueKind: "money"
  },
  {
    key: "invoicing.apOutstanding",
    module: "invoicing",
    kind: "stat",
    size: "sm",
    defaultVisible: false,
    supportsRange: false,
    valueKind: "money"
  },
  {
    key: "invoicing.apOverdue",
    module: "invoicing",
    kind: "stat",
    size: "sm",
    defaultVisible: false,
    supportsRange: false,
    goal: "lower",
    valueKind: "money"
  },
  // Inventory
  {
    key: "inventory.value",
    module: "inventory",
    kind: "stat",
    size: "sm",
    defaultVisible: true,
    supportsRange: false,
    valueKind: "money"
  },
  // Workflows
  {
    key: "workflows.failedRuns",
    module: "workflows",
    kind: "stat",
    size: "sm",
    defaultVisible: false,
    supportsRange: true,
    goal: "lower",
    valueKind: "count"
  }
] as const satisfies readonly WidgetDefinition[];

export type WidgetKey = (typeof DASHBOARD_WIDGETS)[number]["key"];

export const WIDGET_KEYS = DASHBOARD_WIDGETS.map((w) => w.key) as [
  WidgetKey,
  ...WidgetKey[]
];

export function isWidgetKey(value: unknown): value is WidgetKey {
  return typeof value === "string" && (WIDGET_KEYS as string[]).includes(value);
}

export type RegisteredWidget = WidgetDefinition & { key: WidgetKey };

export function getWidgetDefinition(key: string): RegisteredWidget | undefined {
  return DASHBOARD_WIDGETS.find((w) => w.key === key);
}

// ---------------------------------------------------------------------------
// Layout resolution
// ---------------------------------------------------------------------------

export type DashboardLayoutRow = {
  widgetKey: string;
  visible: boolean;
  range: string | null;
};

export type ResolvedWidget = WidgetDefinition & {
  visible: boolean;
  /** Per-widget override; null = follow the page range. */
  range: DashboardRange | null;
};

/**
 * The widgets the user may view, with the user's explicit overrides applied,
 * in the user's saved order. Keys in `order` come first in that order; keys
 * not listed (never dragged, or added to the registry since) follow in
 * registry order. Rows for unknown keys (a widget removed from the registry)
 * or with an invalid range are ignored — a saved layout must never error the
 * home page.
 */
export function resolveDashboardLayout(
  can: (action: "view", module: string) => boolean | undefined,
  rows: DashboardLayoutRow[],
  order: string[] = []
): ResolvedWidget[] {
  const byKey = new Map(rows.map((r) => [r.widgetKey, r]));
  const rank = new Map(order.map((key, index) => [key, index]));
  return DASHBOARD_WIDGETS.filter((w) => can("view", w.module) === true)
    .map((w, registryIndex) => {
      const row = byKey.get(w.key);
      return {
        widget: {
          ...w,
          visible: row?.visible ?? w.defaultVisible,
          range: isDashboardRange(row?.range) ? row.range : null
        },
        // Unlisted keys sort after every listed one, keeping registry order.
        rank: rank.get(w.key) ?? order.length + registryIndex
      };
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ widget }) => widget);
}

/**
 * Percent change vs the prior period, rounded at internal scale. null when
 * there is no prior value to compare against (avoids a meaningless +∞).
 */
export function percentChange(value: number, previous: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return round(((value - previous) / previous) * 100);
}

/** numerator / denominator as a percentage, or 0 when there is no denominator. */
export function ratioPercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator === 0) return 0;
  return round((numerator / denominator) * 100);
}

// ---------------------------------------------------------------------------
// Validators (JSON bodies of the layout / preference API routes)
// ---------------------------------------------------------------------------

export const dashboardLayoutValidator = z.object({
  widgets: z
    .array(
      z.object({
        key: z.enum(WIDGET_KEYS),
        visible: z.boolean(),
        range: z.enum(DASHBOARD_RANGES).nullable()
      })
    )
    .min(1)
});
export type DashboardLayoutInput = z.infer<typeof dashboardLayoutValidator>;

/**
 * A partial patch of the page-wide preference row: the range, the widget
 * order, or both. `order` is the full key list in display order — the section
 * posts every widget it resolved, so a hidden widget keeps its slot.
 */
export const dashboardPreferenceValidator = z
  .object({
    range: z.enum(DASHBOARD_RANGES).optional(),
    order: z.array(z.enum(WIDGET_KEYS)).optional()
  })
  .refine((v) => v.range !== undefined || v.order !== undefined, {
    message: "range or order is required"
  });
export type DashboardPreferenceInput = z.infer<
  typeof dashboardPreferenceValidator
>;

// ---------------------------------------------------------------------------
// Widget payloads (what the widget API returns per kind)
// ---------------------------------------------------------------------------

export type StatPayload = {
  kind: "stat";
  value: number;
  /** Same measure over the previous window; absent for "as of now" stats. */
  previous?: number;
  /** A secondary count shown under the value (e.g. past-due backlog lines). */
  detail?: number;
  /** True when the denominator was empty, so 0 means "no data" not "0%". */
  empty?: boolean;
};

export type TrendPayload = {
  kind: "trend";
  points: { key: string; label: string; value: number }[];
};

export type BreakdownPayload = {
  kind: "breakdown";
  rows: { name: string; value: number; to?: string }[];
};

export type ListPayload = {
  kind: "list";
  rows: {
    id: string;
    title: string;
    subtitle?: string;
    status?: string;
    date?: string;
    to: string;
  }[];
};

export type WidgetPayload =
  | StatPayload
  | TrendPayload
  | BreakdownPayload
  | ListPayload;

export function emptyPayload(kind: WidgetKind): WidgetPayload {
  switch (kind) {
    case "stat":
      return { kind, value: 0, empty: true };
    case "trend":
      return { kind, points: [] };
    case "breakdown":
      return { kind, rows: [] };
    case "list":
      return { kind, rows: [] };
  }
}
