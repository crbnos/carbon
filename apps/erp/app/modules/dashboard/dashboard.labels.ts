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
      "7d": t`Last 7 Days`,
      "30d": t`Last 30 Days`,
      "90d": t`Last 90 Days`,
      mtd: t`Month to Date`,
      qtd: t`Quarter to Date`,
      ytd: t`Year to Date`,
      "12m": t`Last 12 Months`
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
        title: t`Open Sales Orders`,
        description: t`Sales orders not yet shipped and invoiced`
      },
      "sales.openQuotes": {
        title: t`Open Quotes`,
        description: t`Quotes in draft or sent to the customer`
      },
      "sales.revenue": {
        title: t`Sales Revenue`,
        description: t`Total of sales orders placed in the period`
      },
      "sales.revenueTrend": {
        title: t`Revenue Trend`,
        description: t`Sales order value over the period`
      },
      "sales.onTimeDelivery": {
        title: t`On-Time Delivery`,
        description: t`Lines shipped on or before their promised date`
      },
      "sales.openBacklog": {
        title: t`Open Backlog`,
        description: t`Value still to ship on open sales orders`
      },
      "sales.assignedToMe": {
        title: t`Sales Documents Assigned to Me`,
        description: t`Orders, quotes and RFQs where you are the assignee`
      },
      "purchasing.openOrders": {
        title: t`Open Purchase Orders`,
        description: t`Purchase orders not yet received and invoiced`
      },
      "purchasing.overdueOrders": {
        title: t`Overdue Purchase Orders`,
        description: t`Open orders with a line past its promised date`
      },
      "purchasing.spend": {
        title: t`Purchase Spend`,
        description: t`Total of purchase orders placed in the period`
      },
      "purchasing.spendTrend": {
        title: t`Spend Trend`,
        description: t`Purchase order value over the period`
      },
      "purchasing.bySupplier": {
        title: t`Purchases by Supplier`,
        description: t`Top suppliers by purchase order value in the period`
      },
      "purchasing.overdueList": {
        title: t`Overdue Purchase Orders`,
        description: t`Oldest overdue orders first`
      },
      "production.activeJobs": {
        title: t`Active Jobs`,
        description: t`Jobs planned, ready, in progress or paused`
      },
      "production.lateJobs": {
        title: t`Late Jobs`,
        description: t`Active jobs past their due date`
      },
      "production.assignedToMe": {
        title: t`My Active Operations`,
        description: t`Operations you currently have running`
      },
      "production.dueThisWeek": {
        title: t`Jobs Due This Week`,
        description: t`Active jobs due in the next seven days`
      },
      "production.byStatus": {
        title: t`Jobs by Status`,
        description: t`Active jobs grouped by status`
      },
      "production.utilization": {
        title: t`Utilization`,
        description: t`Hours of production time per work center in the period`
      },
      "production.scrapRate": {
        title: t`Scrap Rate`,
        description: t`Scrap as a share of production plus scrap quantities`
      },
      "production.firstPassYield": {
        title: t`First-Pass Yield`,
        description: t`Production quantity without rework or scrap`
      },
      "quality.openIssues": {
        title: t`Open Issues`,
        description: t`Registered and in-progress issues`
      },
      "quality.issuesTrend": {
        title: t`Issues Opened`,
        description: t`New issues over the period`
      },
      "quality.issuesByType": {
        title: t`Issues by Type`,
        description: t`Most frequent issue types in the period`
      },
      "quality.inspectionPassRate": {
        title: t`Inspection Pass Rate`,
        description: t`Inspections passed as a share of those dispositioned`
      },
      "invoicing.arOutstanding": {
        title: t`AR Outstanding`,
        description: t`Customer balances not yet paid`
      },
      "invoicing.arOverdue": {
        title: t`AR Overdue`,
        description: t`Customer balances past their due date`
      },
      "invoicing.apOutstanding": {
        title: t`AP Outstanding`,
        description: t`Supplier balances not yet paid`
      },
      "invoicing.apOverdue": {
        title: t`AP Overdue`,
        description: t`Supplier balances past their due date`
      },
      "inventory.value": {
        title: t`Inventory Value`,
        description: t`On-hand inventory at cost`
      },
      "workflows.failedRuns": {
        title: t`Failed Workflow Runs`,
        description: t`Workflow runs that failed in the period`
      }
    }),
    [t]
  );
}
