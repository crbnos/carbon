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
  label: string;
  description: string;
  category: string;
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
    label: "Income Statement",
    description: "Revenue and expenses over a period",
    route: "/x/reports/income-statement",
    icon: LuTrendingUp,
    category: "Financial Statements",
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "executive-pnl",
    label: "Executive P&L",
    description: "Condensed P&L with margins and key subtotals",
    route: "/x/reports/executive-pnl",
    icon: LuBriefcase,
    category: "Financial Statements",
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "balance-sheet",
    label: "Balance Sheet",
    description: "Assets, liabilities and equity as of a date",
    route: "/x/reports/balance-sheet",
    icon: LuScale,
    category: "Financial Statements",
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "trial-balance",
    label: "Trial Balance",
    description: "Account balances with debits and credits",
    route: "/x/reports/trial-balance",
    icon: LuFileSpreadsheet,
    category: "Close Reports",
    defaultPinned: true,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "inventory-valuation",
    label: "Inventory Valuation",
    description: "On-hand value by location or item, with GL tie-out",
    route: "/x/reports/inventory-valuation",
    icon: LuBoxes,
    category: "Close Reports",
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "revenue",
    label: "Revenue",
    description: "Slice revenue by customer, customer type, or any dimension",
    route: "/x/reports/analytics/revenue",
    icon: LuUsers,
    category: "Analytics",
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "expenses",
    label: "Expenses",
    description: "Slice expenses by location, cost center, or any dimension",
    route: "/x/reports/analytics/expenses",
    icon: LuTruck,
    category: "Analytics",
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "purchases",
    label: "Purchases",
    description:
      "Spend by supplier, item, or category — your biggest cost drivers",
    route: "/x/reports/purchases",
    icon: LuHandCoins,
    category: "Analytics",
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "assets",
    label: "Assets",
    description: "Slice asset activity by location, item, or any dimension",
    route: "/x/reports/analytics/assets",
    icon: LuBanknote,
    category: "Analytics",
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "inventory-change",
    label: "Inventory",
    description: "What drove inventory up or down, by any dimension",
    route: "/x/reports/analytics/inventory-change",
    icon: LuArrowUpDown,
    category: "Analytics",
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "scrap",
    label: "Scrap",
    description: "Biggest causes of scrap by reason, item, or work center",
    route: "/x/reports/analytics/scrap",
    icon: LuRecycle,
    category: "Analytics",
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "ar-aging",
    label: "AR Aging",
    description: "Open receivables by customer and age",
    route: "/x/reports/ar-aging",
    icon: LuHandCoins,
    category: "Aging",
    defaultPinned: false,
    allowedRole: "employee",
    requiredViewPermission: "accounting",
    supportedExportFormats: ["csv"]
  },
  {
    key: "ap-aging",
    label: "AP Aging",
    description: "Open payables by supplier and age",
    route: "/x/reports/ap-aging",
    icon: LuBanknote,
    category: "Aging",
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
