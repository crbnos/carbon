import { path } from "~/utils/path";
import type { WidgetKey } from "./dashboard.models";

// Drill-down targets, kept out of dashboard.models.ts so the registry does not
// import `~/utils/path` (which transitively pulls the glossary's Lingui `msg`
// macro and breaks vitest / Node imports).
export const widgetLinks: Record<WidgetKey, string> = {
  "sales.openOrders": path.to.salesOrders,
  "sales.openQuotes": path.to.quotes,
  "sales.revenue": path.to.salesOrders,
  "sales.revenueTrend": path.to.salesOrders,
  "sales.onTimeDelivery": path.to.salesOrders,
  "sales.openBacklog": path.to.salesOrders,
  "sales.assignedToMe": path.to.sales,
  "purchasing.openOrders": path.to.purchaseOrders,
  "purchasing.overdueOrders": path.to.purchaseOrders,
  "purchasing.spend": path.to.purchaseOrders,
  "purchasing.spendTrend": path.to.purchaseOrders,
  "purchasing.bySupplier": path.to.purchaseOrders,
  "purchasing.overdueList": path.to.purchaseOrders,
  "production.activeJobs": path.to.jobs,
  "production.lateJobs": path.to.jobs,
  "production.assignedToMe": path.to.jobs,
  "production.dueThisWeek": path.to.jobs,
  "production.byStatus": path.to.jobs,
  "production.utilization": path.to.production,
  "production.scrapRate": path.to.production,
  "production.firstPassYield": path.to.production,
  "quality.openIssues": path.to.issues,
  "quality.issuesTrend": path.to.issues,
  "quality.issuesByType": path.to.issues,
  "quality.inspectionPassRate": path.to.quality,
  "invoicing.arOutstanding": path.to.receivables,
  "invoicing.arOverdue": path.to.receivables,
  "invoicing.apOutstanding": path.to.payables,
  "invoicing.apOverdue": path.to.payables,
  "inventory.value": path.to.inventoryValuation,
  "workflows.failedRuns": path.to.workflowRuns
};
