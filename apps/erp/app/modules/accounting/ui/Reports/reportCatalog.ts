import type { MessageDescriptor } from "@lingui/core";
import type { IconType } from "react-icons";
import {
  LuArrowUpDown,
  LuBanknote,
  LuBoxes,
  LuBriefcase,
  LuFileSpreadsheet,
  LuHandCoins,
  LuRecycle,
  LuScale,
  LuTrendingUp,
  LuTruck,
  LuUsers
} from "react-icons/lu";
import type { Role } from "~/types";

export type ReportDefinition = {
  key: string;
  label: MessageDescriptor;
  description: MessageDescriptor;
  category: MessageDescriptor;
  route: string;
  defaultPinned: boolean;
  allowedRole: Role;
  requiredViewPermission: string;
  supportedExportFormats: readonly ["csv"];
  icon: IconType;
};

const reportMessage = (message: string): MessageDescriptor => ({
  id: message,
  message
});

export const reportCatalog: readonly ReportDefinition[] = [
  {
    key: "income-statement",
    label: reportMessage("Income Statement"),
    description: reportMessage("Revenue and expenses over a period"),
    route: "/x/reports/income-statement",
    icon: LuTrendingUp,
    category: reportMessage("Financial Statements"),
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "executive-pnl",
    label: reportMessage("Executive P&L"),
    description: reportMessage("Condensed P&L with margins and key subtotals"),
    route: "/x/reports/executive-pnl",
    icon: LuBriefcase,
    category: reportMessage("Financial Statements"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "balance-sheet",
    label: reportMessage("Balance Sheet"),
    description: reportMessage("Assets, liabilities and equity as of a date"),
    route: "/x/reports/balance-sheet",
    icon: LuScale,
    category: reportMessage("Financial Statements"),
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "trial-balance",
    label: reportMessage("Trial Balance"),
    description: reportMessage("Account balances with debits and credits"),
    route: "/x/reports/trial-balance",
    icon: LuFileSpreadsheet,
    category: reportMessage("Close Reports"),
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "inventory-valuation",
    label: reportMessage("Inventory Valuation"),
    description: reportMessage("On-hand value by location or item, with GL tie-out"),
    route: "/x/reports/inventory-valuation",
    icon: LuBoxes,
    category: reportMessage("Close Reports"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "revenue",
    label: reportMessage("Revenue"),
    description: reportMessage("Slice revenue by customer, customer type, or any dimension"),
    route: "/x/reports/analytics/revenue",
    icon: LuUsers,
    category: reportMessage("Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "expenses",
    label: reportMessage("Expenses"),
    description: reportMessage("Slice expenses by location, cost center, or any dimension"),
    route: "/x/reports/analytics/expenses",
    icon: LuTruck,
    category: reportMessage("Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "purchases",
    label: reportMessage("Purchases"),
    description: reportMessage("Spend by supplier, item, or category — your biggest cost drivers"),
    route: "/x/reports/purchases",
    icon: LuHandCoins,
    category: reportMessage("Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "assets",
    label: reportMessage("Assets"),
    description: reportMessage("Slice asset activity by location, item, or any dimension"),
    route: "/x/reports/analytics/assets",
    icon: LuBanknote,
    category: reportMessage("Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "inventory-change",
    label: reportMessage("Inventory"),
    description: reportMessage("What drove inventory up or down, by any dimension"),
    route: "/x/reports/analytics/inventory-change",
    icon: LuArrowUpDown,
    category: reportMessage("Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "scrap",
    label: reportMessage("Scrap"),
    description: reportMessage("Biggest causes of scrap by reason, item, or work center"),
    route: "/x/reports/analytics/scrap",
    icon: LuRecycle,
    category: reportMessage("Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "ar-aging",
    label: reportMessage("AR Aging"),
    description: reportMessage("Open receivables by customer and age"),
    route: "/x/reports/ar-aging",
    icon: LuHandCoins,
    category: reportMessage("Aging"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "ap-aging",
    label: reportMessage("AP Aging"),
    description: reportMessage("Open payables by supplier and age"),
    route: "/x/reports/ap-aging",
    icon: LuBanknote,
    category: reportMessage("Aging"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  }
];

export function getVisibleReportCatalog(args: {
  role: Role;
  viewPermissions: readonly string[];
}): ReportDefinition[] {
  return reportCatalog.filter(
    (report) =>
      report.allowedRole === args.role &&
      args.viewPermissions.includes(report.requiredViewPermission)
  );
}

export function filterSavedViewsByVisibleReportKeys<
  T extends { reportKey: string }
>(args: {
  savedViews: readonly T[];
  visibleReports: readonly Pick<ReportDefinition, "key">[];
}): T[] {
  const visibleReportKeys = new Set(
    args.visibleReports.map((report) => report.key)
  );

  return args.savedViews.filter((view) =>
    visibleReportKeys.has(view.reportKey)
  );
}

export function filterReportPinsByVisibleEntries<
  T extends { reportKey: string }
>(args: {
  pins: readonly T[];
  visibleReports: readonly Pick<ReportDefinition, "key">[];
  savedViews: readonly Pick<{ id: string }, "id">[];
}): T[] {
  const visibleReportKeys = new Set(
    args.visibleReports.map((report) => report.key)
  );
  const visibleViewPinKeys = new Set(
    args.savedViews.map((view) => `view:${view.id}`)
  );

  return args.pins.filter(
    (pin) =>
      visibleReportKeys.has(pin.reportKey) ||
      visibleViewPinKeys.has(pin.reportKey)
  );
}
