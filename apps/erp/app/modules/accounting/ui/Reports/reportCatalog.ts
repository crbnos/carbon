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
    label: reportMessage(/*i18n*/ "Income Statement"),
    description: reportMessage(/*i18n*/ "Revenue and expenses over a period"),
    route: "/x/reports/income-statement",
    icon: LuTrendingUp,
    category: reportMessage(/*i18n*/ "Financial Statements"),
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "executive-pnl",
    label: reportMessage(/*i18n*/ "Executive P&L"),
    description: reportMessage(
      /*i18n*/ "Condensed P&L with margins and key subtotals"
    ),
    route: "/x/reports/executive-pnl",
    icon: LuBriefcase,
    category: reportMessage(/*i18n*/ "Financial Statements"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "balance-sheet",
    label: reportMessage(/*i18n*/ "Balance Sheet"),
    description: reportMessage(
      /*i18n*/ "Assets, liabilities and equity as of a date"
    ),
    route: "/x/reports/balance-sheet",
    icon: LuScale,
    category: reportMessage(/*i18n*/ "Financial Statements"),
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "trial-balance",
    label: reportMessage(/*i18n*/ "Trial Balance"),
    description: reportMessage(
      /*i18n*/ "Account balances with debits and credits"
    ),
    route: "/x/reports/trial-balance",
    icon: LuFileSpreadsheet,
    category: reportMessage(/*i18n*/ "Close Reports"),
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "inventory-valuation",
    label: reportMessage(/*i18n*/ "Inventory Valuation"),
    description: reportMessage(
      /*i18n*/ "On-hand value by location or item, with GL tie-out"
    ),
    route: "/x/reports/inventory-valuation",
    icon: LuBoxes,
    category: reportMessage(/*i18n*/ "Close Reports"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "revenue",
    label: reportMessage(/*i18n*/ "Revenue"),
    description: reportMessage(
      /*i18n*/ "Slice revenue by customer, customer type, or any dimension"
    ),
    route: "/x/reports/analytics/revenue",
    icon: LuUsers,
    category: reportMessage(/*i18n*/ "Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "expenses",
    label: reportMessage(/*i18n*/ "Expenses"),
    description: reportMessage(
      /*i18n*/ "Slice expenses by location, cost center, or any dimension"
    ),
    route: "/x/reports/analytics/expenses",
    icon: LuTruck,
    category: reportMessage(/*i18n*/ "Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "purchases",
    label: reportMessage(/*i18n*/ "Purchases"),
    description: reportMessage(
      /*i18n*/ "Spend by supplier, item, or category — your biggest cost drivers"
    ),
    route: "/x/reports/purchases",
    icon: LuHandCoins,
    category: reportMessage(/*i18n*/ "Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "assets",
    label: reportMessage(/*i18n*/ "Assets"),
    description: reportMessage(
      /*i18n*/ "Slice asset activity by location, item, or any dimension"
    ),
    route: "/x/reports/analytics/assets",
    icon: LuBanknote,
    category: reportMessage(/*i18n*/ "Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "inventory-change",
    label: reportMessage(/*i18n*/ "Inventory"),
    description: reportMessage(
      /*i18n*/ "What drove inventory up or down, by any dimension"
    ),
    route: "/x/reports/analytics/inventory-change",
    icon: LuArrowUpDown,
    category: reportMessage(/*i18n*/ "Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "scrap",
    label: reportMessage(/*i18n*/ "Scrap"),
    description: reportMessage(
      /*i18n*/ "Biggest causes of scrap by reason, item, or work center"
    ),
    route: "/x/reports/analytics/scrap",
    icon: LuRecycle,
    category: reportMessage(/*i18n*/ "Analytics"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "ar-aging",
    label: reportMessage(/*i18n*/ "AR Aging"),
    description: reportMessage(/*i18n*/ "Open receivables by customer and age"),
    route: "/x/reports/ar-aging",
    icon: LuHandCoins,
    category: reportMessage(/*i18n*/ "Aging"),
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "ap-aging",
    label: reportMessage(/*i18n*/ "AP Aging"),
    description: reportMessage(/*i18n*/ "Open payables by supplier and age"),
    route: "/x/reports/ap-aging",
    icon: LuBanknote,
    category: reportMessage(/*i18n*/ "Aging"),
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
