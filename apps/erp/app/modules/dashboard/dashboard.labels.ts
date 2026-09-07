import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type { DashboardRange, WidgetKey } from "./dashboard.models";

// Translatable copy for the registry in dashboard.models.ts, as hooks: the
// `t` macro is build-time babel, so it lives apart from the runtime registry
// (which vitest / Node import untransformed), and the React macro is the
// house form (test/i18n-react-macros.test.ts bans `t` in app files).

export function useDashboardRangeLabels(): Record<DashboardRange, string> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      "7d": t`Last 7 days`,
      "30d": t`Last 30 days`,
      "90d": t`Last 90 days`,
      mtd: t`Month to date`,
      qtd: t`Quarter to date`,
      ytd: t`Year to date`,
      "12m": t`Last 12 months`
    }),
    [t]
  );
}

export function useWidgetLabels(): Record<
  WidgetKey,
  { title: string; description: string }
> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      "sales.openOrders": {
        title: t`Open sales orders`,
        description: t`Sales orders not yet shipped and invoiced`
      },
      "sales.openQuotes": {
        title: t`Open quotes`,
        description: t`Quotes in draft or sent to the customer`
      },
      "sales.revenue": {
        title: t`Sales revenue`,
        description: t`Total of sales orders placed in the period`
      },
      "sales.revenueTrend": {
        title: t`Revenue trend`,
        description: t`Sales order value over the period`
      },
      "sales.onTimeDelivery": {
        title: t`On-time delivery`,
        description: t`Lines shipped on or before their promised date`
      },
      "sales.openBacklog": {
        title: t`Open backlog`,
        description: t`Value still to ship on open sales orders`
      },
      "sales.assignedToMe": {
        title: t`Sales documents assigned to me`,
        description: t`Orders, quotes and RFQs where you are the assignee`
      },
      "purchasing.openOrders": {
        title: t`Open purchase orders`,
        description: t`Purchase orders not yet received and invoiced`
      },
      "purchasing.overdueOrders": {
        title: t`Overdue purchase orders`,
        description: t`Open orders with a line past its promised date`
      },
      "purchasing.spend": {
        title: t`Purchase spend`,
        description: t`Total of purchase orders placed in the period`
      },
      "purchasing.spendTrend": {
        title: t`Spend trend`,
        description: t`Purchase order value over the period`
      },
      "purchasing.bySupplier": {
        title: t`Purchases by supplier`,
        description: t`Top suppliers by purchase order value in the period`
      },
      "purchasing.overdueList": {
        title: t`Overdue purchase orders`,
        description: t`Oldest overdue orders first`
      },
      "production.activeJobs": {
        title: t`Active jobs`,
        description: t`Jobs planned, ready, in progress or paused`
      },
      "production.lateJobs": {
        title: t`Late jobs`,
        description: t`Active jobs past their due date`
      },
      "production.assignedToMe": {
        title: t`My active operations`,
        description: t`Operations you currently have running`
      },
      "production.dueThisWeek": {
        title: t`Jobs due this week`,
        description: t`Active jobs due in the next seven days`
      },
      "production.byStatus": {
        title: t`Jobs by status`,
        description: t`Active jobs grouped by status`
      },
      "production.utilization": {
        title: t`Utilization`,
        description: t`Hours of production time per work center in the period`
      },
      "production.scrapRate": {
        title: t`Scrap rate`,
        description: t`Scrap as a share of production plus scrap quantities`
      },
      "production.firstPassYield": {
        title: t`First-pass yield`,
        description: t`Production quantity without rework or scrap`
      },
      "quality.openIssues": {
        title: t`Open issues`,
        description: t`Registered and in-progress issues`
      },
      "quality.issuesTrend": {
        title: t`Issues opened`,
        description: t`New issues over the period`
      },
      "quality.issuesByType": {
        title: t`Issues by type`,
        description: t`Most frequent issue types in the period`
      },
      "quality.inspectionPassRate": {
        title: t`Inspection pass rate`,
        description: t`Inspections passed as a share of those dispositioned`
      },
      "invoicing.arOutstanding": {
        title: t`AR outstanding`,
        description: t`Customer balances not yet paid`
      },
      "invoicing.arOverdue": {
        title: t`AR overdue`,
        description: t`Customer balances past their due date`
      },
      "invoicing.apOutstanding": {
        title: t`AP outstanding`,
        description: t`Supplier balances not yet paid`
      },
      "invoicing.apOverdue": {
        title: t`AP overdue`,
        description: t`Supplier balances past their due date`
      },
      "inventory.value": {
        title: t`Inventory value`,
        description: t`On-hand inventory at cost`
      },
      "workflows.failedRuns": {
        title: t`Failed workflow runs`,
        description: t`Workflow runs that failed in the period`
      }
    }),
    [t]
  );
}
