import type { IconType } from "react-icons";
import {
  LuClipboardCheck,
  LuFactory,
  LuForklift,
  LuPackage,
  LuPackagePlus,
  LuRotateCw,
  LuTruck,
  LuWrench
} from "react-icons/lu";

export type ActivityKind =
  | "Receipt"
  | "Manufacturing"
  | "Assembly"
  | "Shipment"
  | "Transfer"
  | "Rework"
  | "Inspection"
  | "Other";

export const ACTIVITY_KIND_META: Record<
  ActivityKind,
  { label: string; color: string; icon: IconType }
> = {
  Receipt: { label: "Receipt", color: "hsl(173 80% 40%)", icon: LuPackagePlus },
  Manufacturing: {
    label: "Manufacturing",
    color: "hsl(280 65% 60%)",
    icon: LuFactory
  },
  Assembly: { label: "Assembly", color: "hsl(265 70% 65%)", icon: LuWrench },
  Shipment: { label: "Shipment", color: "hsl(20 90% 55%)", icon: LuTruck },
  Transfer: { label: "Transfer", color: "hsl(200 80% 55%)", icon: LuForklift },
  Rework: { label: "Rework", color: "hsl(45 95% 55%)", icon: LuRotateCw },
  Inspection: {
    label: "Inspection",
    color: "hsl(330 70% 60%)",
    icon: LuClipboardCheck
  },
  Other: { label: "Other", color: "hsl(280 65% 60%)", icon: LuPackage }
};

export function activityKindFor(type: string | undefined | null): ActivityKind {
  if (!type) return "Other";
  const t = type.toLowerCase();
  if (t.includes("receipt") || t.includes("receive")) return "Receipt";
  if (t.includes("ship")) return "Shipment";
  if (t.includes("transfer")) return "Transfer";
  if (t.includes("rework")) return "Rework";
  if (t.includes("inspect") || t.includes("qc") || t.includes("quality"))
    return "Inspection";
  if (t.includes("assembly") || t.includes("assemble")) return "Assembly";
  if (t.includes("manufactur") || t.includes("mfg") || t.includes("production"))
    return "Manufacturing";
  return "Other";
}
