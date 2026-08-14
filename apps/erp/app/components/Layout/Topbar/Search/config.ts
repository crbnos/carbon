import type { IconType } from "react-icons";
import {
  LuFileCheck,
  LuGauge,
  LuHardHat,
  LuOctagonAlert,
  LuPackageSearch,
  LuShoppingCart,
  LuSquareUser,
  LuUser,
  LuWrench
} from "react-icons/lu";
import { PiShareNetworkFill } from "react-icons/pi";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import type { EntityType } from "~/components/Layout/Topbar/Search/types";

// Entity type styling configuration (keys must match EntityType)
// Order here drives the filter-chip order in the search modal.
// Ranked most-likely-to-be-searched first; issues and gauges last.
export const entityTypeConfig: Record<
  EntityType,
  { bgColor: string; textColor: string; icon: IconType }
> = {
  item: {
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
    textColor: "text-emerald-600 dark:text-emerald-400",
    icon: LuWrench
  },
  job: {
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
    textColor: "text-orange-600 dark:text-orange-400",
    icon: LuHardHat
  },
  salesOrder: {
    bgColor: "bg-teal-100 dark:bg-teal-900/30",
    textColor: "text-teal-600 dark:text-teal-400",
    icon: RiProgress8Line
  },
  purchaseOrder: {
    bgColor: "bg-yellow-100 dark:bg-yellow-900/30",
    textColor: "text-yellow-600 dark:text-yellow-400",
    icon: LuShoppingCart
  },
  customer: {
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    textColor: "text-blue-600 dark:text-blue-400",
    icon: LuSquareUser
  },
  supplier: {
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
    textColor: "text-purple-600 dark:text-purple-400",
    icon: PiShareNetworkFill
  },
  quote: {
    bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
    textColor: "text-indigo-600 dark:text-indigo-400",
    icon: RiProgress4Line
  },
  salesRfq: {
    bgColor: "bg-pink-100 dark:bg-pink-900/30",
    textColor: "text-pink-600 dark:text-pink-400",
    icon: RiProgress2Line
  },
  supplierQuote: {
    bgColor: "bg-violet-100 dark:bg-violet-900/30",
    textColor: "text-violet-600 dark:text-violet-400",
    icon: LuPackageSearch
  },
  salesInvoice: {
    bgColor: "bg-green-100 dark:bg-green-900/30",
    textColor: "text-green-600 dark:text-green-400",
    icon: RiProgress8Line
  },
  purchaseInvoice: {
    bgColor: "bg-red-100 dark:bg-red-900/30",
    textColor: "text-red-600 dark:text-red-400",
    icon: LuFileCheck
  },
  employee: {
    bgColor: "bg-cyan-100 dark:bg-cyan-900/30",
    textColor: "text-cyan-600 dark:text-cyan-400",
    icon: LuUser
  },
  issue: {
    bgColor: "bg-rose-100 dark:bg-rose-900/30",
    textColor: "text-rose-600 dark:text-rose-400",
    icon: LuOctagonAlert
  },
  gauge: {
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    textColor: "text-amber-600 dark:text-amber-400",
    icon: LuGauge
  }
};

export function getEntityTypeConfig(entityType: string) {
  return (
    entityTypeConfig[entityType as EntityType] ?? {
      bgColor: "bg-muted",
      textColor: "text-muted-foreground",
      icon: null
    }
  );
}

export function getEntityTypeLabel(entityType: string): string {
  const labels: Record<string, string> = {
    customer: "Customer",
    supplier: "Supplier",
    gauge: "Gauge",
    issue: "Issue",
    item: "Item",
    job: "Job",
    employee: "Person",
    purchaseOrder: "Purchase Order",
    salesInvoice: "Sales Invoice",
    purchaseInvoice: "Purchase Invoice",
    quote: "Quote",
    salesRfq: "RFQ",
    salesOrder: "Sales Order",
    supplierQuote: "Supplier Quote"
  };
  return labels[entityType] ?? entityType;
}
