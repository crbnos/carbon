import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { QualityKPIs } from "~/modules/quality/quality.models";
import { getCompanySettings } from "~/modules/settings/settings.service.server";

// --- ISO Week Helpers ---

function getISOWeekYear(date: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return { year: d.getUTCFullYear(), week };
}

function formatWeekKey(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function weekKeyFromDate(dateStr: string): string {
  const { year, week } = getISOWeekYear(new Date(dateStr));
  return formatWeekKey(year, week);
}

function generateWeekKeys(startDate: Date, endDate: Date): string[] {
  const keys: string[] = [];
  const current = new Date(startDate);
  current.setDate(current.getDate() - ((current.getDay() + 6) % 7));

  while (current <= endDate) {
    const { year, week } = getISOWeekYear(current);
    keys.push(formatWeekKey(year, week));
    current.setDate(current.getDate() + 7);
  }
  return keys;
}

const PRIORITY_ORDER = ["Critical", "High", "Medium", "Low"] as const;

// --- Loader ---

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const issueTypeId = searchParams.get("issueTypeId");

  const { key } = params;
  if (!key || !start || !end) return { data: [], previousPeriodData: [] };

  const kpi = QualityKPIs.find((k) => k.key === key);
  // Allow avgDaysToClose as a special key
  if (!kpi && key !== "avgDaysToClose")
    return { data: [], previousPeriodData: [] };

  switch (key) {
    case "weeklyTracking": {
      const [issuesResult, settingsResult] = await Promise.all([
        getIssuesQuery(client, { companyId, issueTypeId }),
        getCompanySettings()
      ]);

      const issues = issuesResult.data ?? [];
      const endDate = new Date(end);
      const startDate = new Date(start);

      const allWeekKeys = generateWeekKeys(startDate, endDate);
      const weekMap = new Map<string, { opened: number; closed: number }>();
      for (const k of allWeekKeys) {
        weekMap.set(k, { opened: 0, closed: 0 });
      }

      const startKey = allWeekKeys[0];

      for (const issue of issues) {
        if (!issue.openDate) continue;
        const openKey = weekKeyFromDate(issue.openDate);

        if (weekMap.has(openKey)) {
          weekMap.get(openKey)!.opened++;
        }

        if (issue.closeDate) {
          const closeKey = weekKeyFromDate(issue.closeDate);
          if (closeKey >= startKey && weekMap.has(closeKey)) {
            weekMap.get(closeKey)!.closed++;
          }
        }
      }

      const data = allWeekKeys.map((week) => {
        const entry = weekMap.get(week)!;
        return {
          week,
          opened: entry.opened,
          closed: entry.closed
        };
      });

      const totalClosed = data.reduce((sum, d) => sum + d.closed, 0);

      return {
        data,
        previousPeriodData: [],
        meta: {
          qualityIssueTarget: settingsResult.data?.qualityIssueTarget ?? 20,
          totalClosed
        }
      };
    }

    case "statusDistribution": {
      const issues = await getFilteredIssuesQuery(client, {
        companyId,
        start,
        end,
        issueTypeId
      });

      const counts: Record<string, number> = {
        Registered: 0,
        "In Progress": 0,
        Closed: 0
      };
      for (const issue of issues.data ?? []) {
        if (issue.status && counts[issue.status] !== undefined) {
          counts[issue.status]++;
        }
      }

      return {
        data: [
          {
            name: "Registered",
            value: counts.Registered,
            fill: "hsl(var(--chart-5))"
          },
          {
            name: "In Progress",
            value: counts["In Progress"],
            fill: "hsl(var(--chart-1))"
          },
          {
            name: "Closed",
            value: counts.Closed,
            fill: "hsl(var(--success))"
          }
        ],
        previousPeriodData: []
      };
    }

    case "paretoByType": {
      const [issues, types] = await Promise.all([
        getFilteredIssuesQuery(client, {
          companyId,
          start,
          end,
          issueTypeId
        }),
        getIssueTypesMap(client, companyId)
      ]);

      const counts: Record<string, number> = {};
      for (const issue of issues.data ?? []) {
        const typeName =
          types.get(issue.nonConformanceTypeId ?? "") ?? "Unknown";
        counts[typeName] = (counts[typeName] || 0) + 1;
      }

      const sorted = Object.entries(counts)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);

      const total = sorted.reduce((sum, d) => sum + d.count, 0);
      let cumulative = 0;
      const data = sorted.map((d) => {
        cumulative += d.count;
        return {
          ...d,
          cumulative: total > 0 ? Math.round((cumulative / total) * 100) : 0
        };
      });

      return { data, previousPeriodData: [] };
    }

    case "ncrsByType": {
      const [issues, types] = await Promise.all([
        getFilteredIssuesQuery(client, {
          companyId,
          start,
          end,
          issueTypeId
        }),
        getIssueTypesMap(client, companyId)
      ]);

      const grid: Record<string, Record<string, number>> = {};
      for (const issue of issues.data ?? []) {
        const typeName =
          types.get(issue.nonConformanceTypeId ?? "") ?? "Unknown";
        if (!grid[typeName]) {
          grid[typeName] = { Critical: 0, High: 0, Medium: 0, Low: 0 };
        }
        if (issue.priority) {
          grid[typeName][issue.priority]++;
        }
      }

      const data = Object.entries(grid)
        .sort(([, a], [, b]) => {
          const totalA = a.Critical + a.High + a.Medium + a.Low;
          const totalB = b.Critical + b.High + b.Medium + b.Low;
          return totalB - totalA;
        })
        .map(([type, counts]) => ({ type, ...counts }));

      return { data, previousPeriodData: [] };
    }

    case "sourceAnalysis": {
      const issues = await getFilteredIssuesQuery(client, {
        companyId,
        start,
        end,
        issueTypeId
      });

      const grid: Record<string, Record<string, number>> = {};
      for (const p of PRIORITY_ORDER) {
        grid[p] = { Internal: 0, External: 0 };
      }
      for (const issue of issues.data ?? []) {
        if (!issue.priority || !issue.source) continue;
        if (grid[issue.priority]) {
          grid[issue.priority][issue.source]++;
        }
      }

      const data = PRIORITY_ORDER.map((priority) => ({
        priority,
        ...grid[priority]
      }));

      return { data, previousPeriodData: [] };
    }

    case "supplierQuality": {
      const issues = await getFilteredIssuesQuery(client, {
        companyId,
        start,
        end,
        issueTypeId
      });

      const issueIds = (issues.data ?? []).map((i) => i.id);
      if (issueIds.length === 0) {
        return { data: [], previousPeriodData: [] };
      }

      const supplierIssues = await client
        .from("nonConformanceSupplier")
        .select("nonConformanceId, supplier:supplier(id, name)")
        .eq("companyId", companyId)
        .in("nonConformanceId", issueIds as string[]);

      const counts: Record<string, { name: string; count: number }> = {};
      for (const si of supplierIssues.data ?? []) {
        const supplier = si.supplier as { id: string; name: string } | null;
        if (!supplier) continue;
        if (!counts[supplier.id]) {
          counts[supplier.id] = { name: supplier.name, count: 0 };
        }
        counts[supplier.id].count++;
      }

      const data = Object.values(counts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return { data, previousPeriodData: [] };
    }

    case "weeksOpen": {
      // Aging chart — uses open issues only, not date-filtered
      let query = client
        .from("issues")
        .select("id, openDate, priority, status")
        .eq("companyId", companyId)
        .in("status", ["Registered", "In Progress"]);

      if (issueTypeId) {
        query = query.eq("nonConformanceTypeId", issueTypeId);
      }

      const issues = await query;
      const now = Date.now();

      const grid: Record<string, Record<string, number>> = {};
      for (const p of PRIORITY_ORDER) {
        grid[p] = {
          "0-4 weeks": 0,
          "5-8 weeks": 0,
          "9-12 weeks": 0,
          "13+ weeks": 0
        };
      }

      for (const issue of issues.data ?? []) {
        if (!issue.openDate || !issue.priority) continue;
        const weeksOpen = Math.floor(
          (now - new Date(issue.openDate).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        let bucket: string;
        if (weeksOpen <= 4) bucket = "0-4 weeks";
        else if (weeksOpen <= 8) bucket = "5-8 weeks";
        else if (weeksOpen <= 12) bucket = "9-12 weeks";
        else bucket = "13+ weeks";

        if (grid[issue.priority]) {
          grid[issue.priority][bucket]++;
        }
      }

      const data = PRIORITY_ORDER.map((criticality) => ({
        criticality,
        ...grid[criticality]
      }));

      return { data, previousPeriodData: [] };
    }

    case "avgDaysToClose": {
      const issues = await getFilteredIssuesQuery(client, {
        companyId,
        start,
        end,
        issueTypeId
      });

      let total = 0;
      let count = 0;
      for (const issue of issues.data ?? []) {
        if (issue.status !== "Closed" || !issue.openDate || !issue.closeDate)
          continue;
        const days = Math.floor(
          (new Date(issue.closeDate).getTime() -
            new Date(issue.openDate).getTime()) /
            (24 * 60 * 60 * 1000)
        );
        if (days >= 0) {
          total += days;
          count++;
        }
      }

      return {
        data: [{ value: count > 0 ? Math.round(total / count) : null }],
        previousPeriodData: []
      };
    }

    default:
      return { data: [], previousPeriodData: [] };
  }
}

// --- Query Helpers ---

async function getIssuesQuery(
  client: SupabaseClient<Database>,
  {
    companyId,
    issueTypeId
  }: {
    companyId: string;
    issueTypeId: string | null;
  }
) {
  let query = client
    .from("issues")
    .select(
      "id, status, priority, source, openDate, closeDate, nonConformanceTypeId, containmentStatus, createdAt"
    )
    .eq("companyId", companyId);

  if (issueTypeId) {
    query = query.eq("nonConformanceTypeId", issueTypeId);
  }

  return query;
}

async function getFilteredIssuesQuery(
  client: SupabaseClient<Database>,
  {
    companyId,
    start,
    end,
    issueTypeId
  }: {
    companyId: string;
    start: string;
    end: string;
    issueTypeId: string | null;
  }
) {
  let query = client
    .from("issues")
    .select(
      "id, status, priority, source, openDate, closeDate, nonConformanceTypeId, containmentStatus, createdAt"
    )
    .eq("companyId", companyId)
    .gte("openDate", start)
    .lte("openDate", end);

  if (issueTypeId) {
    query = query.eq("nonConformanceTypeId", issueTypeId);
  }

  return query;
}

async function getIssueTypesMap(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<Map<string, string>> {
  const result = await client
    .from("nonConformanceType")
    .select("id, name")
    .eq("companyId", companyId);

  const map = new Map<string, string>();
  for (const t of result.data ?? []) {
    map.set(t.id, t.name);
  }
  return map;
}
