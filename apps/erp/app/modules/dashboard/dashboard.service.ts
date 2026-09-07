import type { Database } from "@carbon/database";
import { datetime, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getInventoryValuation } from "~/modules/inventory/inventory.service";
import { getApAging, getArAging } from "~/modules/invoicing/invoicing.service";
import { ACTIVE_JOB_STATUSES } from "~/modules/production/production.models";
import { getWorkCenterUtilization } from "~/modules/production/production.service";
import { getSalesDocumentsAssignedToMe } from "~/modules/sales/sales.service";
import { groupDataByDay, groupDataByMonth } from "~/utils/chart";
import { path } from "~/utils/path";
import type {
  BreakdownPayload,
  DashboardPreferenceInput,
  DashboardRange,
  DashboardWindow,
  ListPayload,
  StatPayload,
  TrendPayload,
  WidgetKey,
  WidgetPayload
} from "./dashboard.models";
import { ratioPercent } from "./dashboard.models";

// ---------------------------------------------------------------------------
// Layout + preference (per user, per company; RLS restricts rows to the owner)
// ---------------------------------------------------------------------------

export async function getDashboardLayout(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("userDashboardWidget")
    .select("widgetKey, visible, range")
    .eq("userId", userId)
    .eq("companyId", companyId);
}

export async function getDashboardPreference(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("userDashboardPreference")
    .select("range, widgetOrder")
    .eq("userId", userId)
    .eq("companyId", companyId)
    .maybeSingle();
}

export async function upsertDashboardWidgets(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  widgets: { key: WidgetKey; visible: boolean; range: DashboardRange | null }[]
) {
  const now = datetime.timestamp();
  return client.from("userDashboardWidget").upsert(
    widgets.map((w) => ({
      widgetKey: w.key,
      userId,
      companyId,
      visible: w.visible,
      range: w.range,
      createdBy: userId,
      updatedBy: userId,
      updatedAt: now
    })),
    { onConflict: "widgetKey,userId,companyId" }
  );
}

/**
 * Patch the one preference row. Only the fields present are written, so a
 * range change never resets the order and a drag never resets the range
 * (an upsert updates only the columns it is given).
 */
export async function upsertDashboardPreference(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  patch: DashboardPreferenceInput
) {
  return client.from("userDashboardPreference").upsert(
    {
      userId,
      companyId,
      ...(patch.range !== undefined ? { range: patch.range } : {}),
      ...(patch.order !== undefined ? { widgetOrder: patch.order } : {}),
      updatedAt: datetime.timestamp()
    },
    { onConflict: "userId,companyId" }
  );
}

// ---------------------------------------------------------------------------
// Widget data
// ---------------------------------------------------------------------------

export type WidgetWindow = DashboardWindow & {
  /** The company's current calendar day, YYYY-MM-DD — for "as of now" widgets. */
  today: string;
};

// Status constants mirror the module dashboards so the home page and the
// module page agree on what "open" means.
// apps/erp/app/routes/x+/sales+/_index.tsx
const OPEN_SALES_ORDER_STATUSES = [
  "Confirmed",
  "To Ship and Invoice",
  "To Ship",
  "To Invoice",
  "Needs Approval",
  "In Progress",
  "Draft"
] as const;
const OPEN_QUOTE_STATUSES = ["Sent", "Draft"] as const;
// apps/erp/app/routes/x+/purchasing+/_index.tsx
const OPEN_PURCHASE_ORDER_STATUSES = [
  "Draft",
  "To Review",
  "To Receive",
  "To Receive and Invoice",
  "Needs Approval",
  "Planned",
  "To Invoice"
] as const;
// apps/erp/app/routes/x+/quality+/_index.tsx
const OPEN_ISSUE_STATUSES = ["Registered", "In Progress"] as const;

/** Rows shown by a list widget, and bars in a breakdown. */
const TOP_N = 8;
const DAYS_IN_WEEK = 7;
const MS_PER_HOUR = 3_600_000;

const nextDay = (date: string) => parseDate(date).add({ days: 1 }).toString();

const stat = (
  value: number,
  previous?: number,
  extra?: Partial<StatPayload>
): StatPayload => ({ kind: "stat", value, previous, ...extra });

const sumBy = <T>(rows: T[] | null | undefined, pick: (row: T) => number) =>
  (rows ?? []).reduce((sum, row) => sum + (pick(row) || 0), 0);

function trendFrom<
  T extends { orderDate?: string | null; openDate?: string | null }
>(
  rows: T[],
  window: WidgetWindow,
  groupBy: keyof T,
  pick: (row: T) => number
): TrendPayload {
  const grouped =
    window.bucket === "day"
      ? groupDataByDay(rows, { start: window.start, end: window.end, groupBy })
      : groupDataByMonth(rows, {
          start: window.start,
          end: window.end,
          groupBy
        });
  return {
    kind: "trend",
    points: Object.entries(grouped).map(([key, bucketRows]) => ({
      key,
      label: key,
      value: sumBy(bucketRows, pick)
    }))
  };
}

async function salesOrdersInWindow(
  client: SupabaseClient<Database>,
  companyId: string,
  start: string,
  end: string
) {
  return client
    .from("salesOrders")
    .select("orderTotal, orderDate")
    .eq("companyId", companyId)
    .gte("orderDate", start)
    .lte("orderDate", end);
}

async function purchaseOrdersInWindow(
  client: SupabaseClient<Database>,
  companyId: string,
  start: string,
  end: string
) {
  return client
    .from("purchaseOrders")
    .select("orderTotal, orderDate, supplierId")
    .eq("companyId", companyId)
    .gte("orderDate", start)
    .lte("orderDate", end);
}

async function issuesInWindow(
  client: SupabaseClient<Database>,
  companyId: string,
  start: string,
  end: string
) {
  return client
    .from("issues")
    .select("id, openDate, nonConformanceTypeId")
    .eq("companyId", companyId)
    .gte("openDate", start)
    .lte("openDate", end);
}

/** Count rows in a status set. The caller builds the query so each table keeps its own row type. */
async function countOpen(query: PromiseLike<{ count: number | null }>) {
  return (await query).count ?? 0;
}

const openCount = (client: SupabaseClient<Database>, companyId: string) => ({
  salesOrders: () =>
    countOpen(
      client
        .from("salesOrder")
        .select("id", { count: "exact", head: true })
        .eq("companyId", companyId)
        .in("status", [...OPEN_SALES_ORDER_STATUSES])
    ),
  quotes: () =>
    countOpen(
      client
        .from("quote")
        .select("id", { count: "exact", head: true })
        .eq("companyId", companyId)
        .in("status", [...OPEN_QUOTE_STATUSES])
    ),
  purchaseOrders: () =>
    countOpen(
      client
        .from("purchaseOrder")
        .select("id", { count: "exact", head: true })
        .eq("companyId", companyId)
        .in("status", [...OPEN_PURCHASE_ORDER_STATUSES])
    ),
  jobs: () =>
    countOpen(
      client
        .from("job")
        .select("id", { count: "exact", head: true })
        .eq("companyId", companyId)
        .in("status", ACTIVE_JOB_STATUSES)
    ),
  issues: () =>
    countOpen(
      client
        .from("issues")
        .select("id", { count: "exact", head: true })
        .eq("companyId", companyId)
        .in("status", [...OPEN_ISSUE_STATUSES])
    )
});

/** Sum of an aging RPC's rows. "Overdue" = every bucket past current. */
function agingTotals(
  rows:
    | {
        current: number | null;
        bucket1: number | null;
        bucket2: number | null;
        bucket3: number | null;
        bucket4: number | null;
        total: number | null;
      }[]
    | null
) {
  const outstanding = sumBy(rows, (r) => Number(r.total ?? 0));
  const overdue = sumBy(
    rows,
    (r) =>
      Number(r.bucket1 ?? 0) +
      Number(r.bucket2 ?? 0) +
      Number(r.bucket3 ?? 0) +
      Number(r.bucket4 ?? 0)
  );
  return { outstanding, overdue };
}

async function supplierNames(
  client: SupabaseClient<Database>,
  companyId: string,
  ids: string[]
) {
  if (ids.length === 0) return new Map<string, string>();
  const result = await client
    .from("supplier")
    .select("id, name")
    .eq("companyId", companyId)
    .in("id", ids);
  return new Map((result.data ?? []).map((s) => [s.id, s.name]));
}

/**
 * The payload for one widget. One arm per registry key, no `default`, so a
 * key added to the registry without an arm is a type error rather than a
 * silent empty card (.ai/lessons.md: a default arm defeats exhaustiveness).
 */
export async function getWidgetData(
  client: SupabaseClient<Database>,
  args: {
    key: WidgetKey;
    companyId: string;
    userId: string;
    window: WidgetWindow;
  }
): Promise<WidgetPayload> {
  const { key, companyId, userId, window } = args;
  const { start, end, previousStart, previousEnd, today } = window;

  switch (key) {
    // ---------------------------------------------------------------- sales
    case "sales.openOrders":
      return stat(await openCount(client, companyId).salesOrders());

    case "sales.openQuotes":
      return stat(await openCount(client, companyId).quotes());

    case "sales.revenue": {
      const [current, previous] = await Promise.all([
        salesOrdersInWindow(client, companyId, start, end),
        salesOrdersInWindow(client, companyId, previousStart, previousEnd)
      ]);
      return stat(
        sumBy(current.data, (r) => Number(r.orderTotal ?? 0)),
        sumBy(previous.data, (r) => Number(r.orderTotal ?? 0))
      );
    }

    case "sales.revenueTrend": {
      const current = await salesOrdersInWindow(client, companyId, start, end);
      return trendFrom(current.data ?? [], window, "orderDate", (r) =>
        Number(r.orderTotal ?? 0)
      );
    }

    case "sales.onTimeDelivery": {
      const [current, previous] = await Promise.all([
        client.rpc("get_on_time_delivery", {
          company_id: companyId,
          start_date: start,
          end_date: end
        }),
        client.rpc("get_on_time_delivery", {
          company_id: companyId,
          start_date: previousStart,
          end_date: previousEnd
        })
      ]);
      const c = current.data?.[0];
      const p = previous.data?.[0];
      const shipped = Number(c?.shipped ?? 0);
      return stat(
        ratioPercent(Number(c?.onTime ?? 0), shipped),
        ratioPercent(Number(p?.onTime ?? 0), Number(p?.shipped ?? 0)),
        { empty: shipped === 0 }
      );
    }

    case "sales.openBacklog": {
      const result = await client.rpc("get_open_backlog", {
        company_id: companyId,
        as_of: today
      });
      const row = result.data?.[0];
      return stat(Number(row?.value ?? 0), undefined, {
        detail: Number(row?.pastDueLines ?? 0),
        empty: Number(row?.lines ?? 0) === 0
      });
    }

    case "sales.assignedToMe": {
      const docs = await getSalesDocumentsAssignedToMe(
        client,
        userId,
        companyId
      );
      const rows: ListPayload["rows"] = docs
        .slice(-TOP_N)
        .reverse()
        .map((doc) => {
          switch (doc.type) {
            case "salesOrder":
              return {
                id: doc.id,
                title:
                  (doc as { salesOrderId?: string }).salesOrderId ?? doc.id,
                status: doc.status ?? undefined,
                date: doc.createdAt ?? undefined,
                to: path.to.salesOrder(doc.id)
              };
            case "quote":
              return {
                id: doc.id,
                title: (doc as { quoteId?: string }).quoteId ?? doc.id,
                status: doc.status ?? undefined,
                date: doc.createdAt ?? undefined,
                to: path.to.quote(doc.id)
              };
            default:
              return {
                id: doc.id,
                title: (doc as { rfqId?: string }).rfqId ?? doc.id,
                status: doc.status ?? undefined,
                date: doc.createdAt ?? undefined,
                to: path.to.salesRfq(doc.id)
              };
          }
        });
      return { kind: "list", rows };
    }

    // ----------------------------------------------------------- purchasing
    case "purchasing.openOrders":
      return stat(await openCount(client, companyId).purchaseOrders());

    case "purchasing.overdueOrders": {
      const result = await client.rpc("get_overdue_purchase_orders", {
        company_id: companyId,
        as_of: today
      });
      return stat(result.data?.length ?? 0);
    }

    case "purchasing.overdueList": {
      const result = await client.rpc("get_overdue_purchase_orders", {
        company_id: companyId,
        as_of: today
      });
      const top = (result.data ?? []).slice(0, TOP_N);
      const names = await supplierNames(
        client,
        companyId,
        top.map((r) => r.supplierId).filter((id): id is string => !!id)
      );
      return {
        kind: "list",
        rows: top.map((r) => ({
          id: r.id,
          title: r.purchaseOrderId,
          subtitle: r.supplierId ? names.get(r.supplierId) : undefined,
          date: r.earliestPromisedDate ?? undefined,
          to: path.to.purchaseOrder(r.id)
        }))
      };
    }

    case "purchasing.spend": {
      const [current, previous] = await Promise.all([
        purchaseOrdersInWindow(client, companyId, start, end),
        purchaseOrdersInWindow(client, companyId, previousStart, previousEnd)
      ]);
      return stat(
        sumBy(current.data, (r) => Number(r.orderTotal ?? 0)),
        sumBy(previous.data, (r) => Number(r.orderTotal ?? 0))
      );
    }

    case "purchasing.spendTrend": {
      const current = await purchaseOrdersInWindow(
        client,
        companyId,
        start,
        end
      );
      return trendFrom(current.data ?? [], window, "orderDate", (r) =>
        Number(r.orderTotal ?? 0)
      );
    }

    case "purchasing.bySupplier": {
      const current = await purchaseOrdersInWindow(
        client,
        companyId,
        start,
        end
      );
      const totals = new Map<string, number>();
      for (const row of current.data ?? []) {
        if (!row.supplierId) continue;
        totals.set(
          row.supplierId,
          (totals.get(row.supplierId) ?? 0) + Number(row.orderTotal ?? 0)
        );
      }
      const top = [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_N);
      const names = await supplierNames(
        client,
        companyId,
        top.map(([id]) => id)
      );
      return {
        kind: "breakdown",
        rows: top.map(([id, value]) => ({
          name: names.get(id) ?? id,
          value
        }))
      };
    }

    // ----------------------------------------------------------- production
    case "production.activeJobs":
      return stat(await openCount(client, companyId).jobs());

    case "production.lateJobs": {
      const result = await client
        .from("job")
        .select("id", { count: "exact", head: true })
        .eq("companyId", companyId)
        .in("status", ACTIVE_JOB_STATUSES)
        .lt("dueDate", today);
      return stat(result.count ?? 0);
    }

    case "production.assignedToMe": {
      const result = await client.rpc("get_active_job_count", {
        employee_id: userId,
        company_id: companyId
      });
      return stat(Number(result.data ?? 0));
    }

    case "production.dueThisWeek": {
      const weekEnd = parseDate(today)
        .add({ days: DAYS_IN_WEEK - 1 })
        .toString();
      const result = await client
        .from("jobs")
        .select("id, jobId, itemReadableIdWithRevision, dueDate, status")
        .eq("companyId", companyId)
        .in("status", ACTIVE_JOB_STATUSES)
        .gte("dueDate", today)
        .lte("dueDate", weekEnd)
        .order("dueDate", { ascending: true })
        .limit(TOP_N);
      return {
        kind: "list",
        rows: (result.data ?? []).map((j) => ({
          id: j.id!,
          title: j.jobId ?? j.id!,
          subtitle: j.itemReadableIdWithRevision ?? undefined,
          status: j.status ?? undefined,
          date: j.dueDate ?? undefined,
          to: path.to.job(j.id!)
        }))
      };
    }

    case "production.byStatus": {
      const result = await client
        .from("job")
        .select("status")
        .eq("companyId", companyId)
        .in("status", ACTIVE_JOB_STATUSES);
      const counts = new Map<string, number>();
      for (const row of result.data ?? []) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      }
      return {
        kind: "breakdown",
        rows: ACTIVE_JOB_STATUSES.map((status) => ({
          name: status,
          value: counts.get(status) ?? 0
        }))
      };
    }

    case "production.utilization": {
      const result = await getWorkCenterUtilization(client, companyId, {
        start,
        end,
        previousStart,
        previousEnd,
        currentDate: datetime.timestamp()
      });
      return {
        kind: "breakdown",
        rows: result.data.slice(0, TOP_N).map((r) => ({
          name: r.key,
          value: round(r.value / MS_PER_HOUR)
        }))
      };
    }

    case "production.scrapRate":
    case "production.firstPassYield": {
      const [current, previous] = await Promise.all([
        client.rpc("get_production_quantity_summary", {
          company_id: companyId,
          start_date: start,
          end_date: end
        }),
        client.rpc("get_production_quantity_summary", {
          company_id: companyId,
          start_date: previousStart,
          end_date: previousEnd
        })
      ]);
      const c = current.data?.[0];
      const p = previous.data?.[0];
      const cp = Number(c?.production ?? 0);
      const cs = Number(c?.scrap ?? 0);
      const cr = Number(c?.rework ?? 0);
      const pp = Number(p?.production ?? 0);
      const ps = Number(p?.scrap ?? 0);
      const pr = Number(p?.rework ?? 0);
      if (key === "production.scrapRate") {
        return stat(ratioPercent(cs, cp + cs), ratioPercent(ps, pp + ps), {
          empty: cp + cs === 0
        });
      }
      return stat(
        ratioPercent(cp, cp + cr + cs),
        ratioPercent(pp, pp + pr + ps),
        { empty: cp + cr + cs === 0 }
      );
    }

    // -------------------------------------------------------------- quality
    case "quality.openIssues":
      return stat(await openCount(client, companyId).issues());

    case "quality.issuesTrend": {
      const current = await issuesInWindow(client, companyId, start, end);
      return trendFrom(current.data ?? [], window, "openDate", () => 1);
    }

    case "quality.issuesByType": {
      const current = await issuesInWindow(client, companyId, start, end);
      const counts = new Map<string, number>();
      for (const row of current.data ?? []) {
        const id = row.nonConformanceTypeId ?? "";
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      const ids = [...counts.keys()].filter(Boolean);
      const types =
        ids.length === 0
          ? { data: [] as { id: string; name: string }[] }
          : await client
              .from("nonConformanceType")
              .select("id, name")
              .eq("companyId", companyId)
              .in("id", ids);
      const names = new Map((types.data ?? []).map((t) => [t.id, t.name]));
      return {
        kind: "breakdown",
        rows: [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, TOP_N)
          .map(([id, value]) => ({ name: names.get(id) ?? "Unknown", value }))
      };
    }

    case "quality.inspectionPassRate": {
      const [current, previous] = await Promise.all([
        client.rpc("get_inspection_pass_rate", {
          company_id: companyId,
          start_date: start,
          end_date: end
        }),
        client.rpc("get_inspection_pass_rate", {
          company_id: companyId,
          start_date: previousStart,
          end_date: previousEnd
        })
      ]);
      const c = current.data?.[0];
      const p = previous.data?.[0];
      const total = Number(c?.passed ?? 0) + Number(c?.failed ?? 0);
      return stat(
        ratioPercent(Number(c?.passed ?? 0), total),
        ratioPercent(
          Number(p?.passed ?? 0),
          Number(p?.passed ?? 0) + Number(p?.failed ?? 0)
        ),
        { empty: total === 0 }
      );
    }

    // ------------------------------------------------------------ invoicing
    case "invoicing.arOutstanding":
    case "invoicing.arOverdue": {
      const aging = await getArAging(client, companyId, today, {});
      const totals = agingTotals(aging.data);
      return stat(
        key === "invoicing.arOutstanding" ? totals.outstanding : totals.overdue
      );
    }

    case "invoicing.apOutstanding":
    case "invoicing.apOverdue": {
      const aging = await getApAging(client, companyId, today, {});
      const totals = agingTotals(aging.data);
      return stat(
        key === "invoicing.apOutstanding" ? totals.outstanding : totals.overdue
      );
    }

    // ------------------------------------------------------------ inventory
    case "inventory.value": {
      const result = await getInventoryValuation(client, companyId, {
        asOfDate: today
      });
      return stat(sumBy(result.data, (r) => Number(r.totalValue ?? 0)));
    }

    // ------------------------------------------------------------ workflows
    case "workflows.failedRuns": {
      const failedIn = (from: string, to: string) =>
        client
          .from("workflowRun")
          .select("id", { count: "exact", head: true })
          .eq("companyId", companyId)
          .eq("status", "Failed")
          .gte("completedAt", from)
          .lt("completedAt", nextDay(to));
      const [current, previous] = await Promise.all([
        failedIn(start, end),
        failedIn(previousStart, previousEnd)
      ]);
      return stat(current.count ?? 0, previous.count ?? 0);
    }
  }
}

// Keep the exported payload types reachable from the barrel for UI consumers.
export type { BreakdownPayload, ListPayload, StatPayload, TrendPayload };
