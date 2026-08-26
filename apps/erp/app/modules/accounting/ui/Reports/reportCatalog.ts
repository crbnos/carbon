import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
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

export const reportCatalog: readonly ReportDefinition[] = [
  {
    key: "income-statement",
    label: msg`Income Statement`,
    description: msg`Revenue and expenses over a period`,
    route: "/x/reports/income-statement",
    icon: LuTrendingUp,
    category: msg`Financial Statements`,
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "executive-pnl",
    label: msg`Executive P&L`,
    description: msg`Condensed P&L with margins and key subtotals`,
    route: "/x/reports/executive-pnl",
    icon: LuBriefcase,
    category: msg`Financial Statements`,
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "balance-sheet",
    label: msg`Balance Sheet`,
    description: msg`Assets, liabilities and equity as of a date`,
    route: "/x/reports/balance-sheet",
    icon: LuScale,
    category: msg`Financial Statements`,
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "trial-balance",
    label: msg`Trial Balance`,
    description: msg`Account balances with debits and credits`,
    route: "/x/reports/trial-balance",
    icon: LuFileSpreadsheet,
    category: msg`Close Reports`,
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "inventory-valuation",
    label: msg`Inventory Valuation`,
    description: msg`On-hand value by location or item, with GL tie-out`,
    route: "/x/reports/inventory-valuation",
    icon: LuBoxes,
    category: msg`Close Reports`,
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "revenue",
    label: msg`Revenue`,
    description: msg`Slice revenue by customer, customer type, or any dimension`,
    route: "/x/reports/analytics/revenue",
    icon: LuUsers,
    category: msg`Analytics`,
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "expenses",
    label: msg`Expenses`,
    description: msg`Slice expenses by location, cost center, or any dimension`,
    route: "/x/reports/analytics/expenses",
    icon: LuTruck,
    category: msg`Analytics`,
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "purchases",
    label: msg`Purchases`,
    description: msg`Spend by supplier, item, or category — your biggest cost drivers`,
    route: "/x/reports/purchases",
    icon: LuHandCoins,
    category: msg`Analytics`,
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "assets",
    label: msg`Assets`,
    description: msg`Slice asset activity by location, item, or any dimension`,
    route: "/x/reports/analytics/assets",
    icon: LuBanknote,
    category: msg`Analytics`,
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "inventory-change",
    label: msg`Inventory`,
    description: msg`What drove inventory up or down, by any dimension`,
    route: "/x/reports/analytics/inventory-change",
    icon: LuArrowUpDown,
    category: msg`Analytics`,
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "scrap",
    label: msg`Scrap`,
    description: msg`Biggest causes of scrap by reason, item, or work center`,
    route: "/x/reports/analytics/scrap",
    icon: LuRecycle,
    category: msg`Analytics`,
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "ar-aging",
    label: msg`AR Aging`,
    description: msg`Open receivables by customer and age`,
    route: "/x/reports/ar-aging",
    icon: LuHandCoins,
    category: msg`Aging`,
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "ap-aging",
    label: msg`AP Aging`,
    description: msg`Open payables by supplier and age`,
    route: "/x/reports/ap-aging",
    icon: LuBanknote,
    category: msg`Aging`,
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

  return args.savedViews.filter((view) => visibleReportKeys.has(view.reportKey));
}
