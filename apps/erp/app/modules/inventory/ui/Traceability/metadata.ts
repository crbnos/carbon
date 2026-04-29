import type { IconType } from "react-icons";
import {
  LuClipboardCheck,
  LuFactory,
  LuForklift,
  LuPackage,
  LuPackageCheck,
  LuPackageMinus,
  LuPackageOpen,
  LuPackagePlus,
  LuPackageX,
  LuPause,
  LuRotateCw,
  LuTruck,
  LuWrench
} from "react-icons/lu";

export type EntityStatus =
  | "Available"
  | "Reserved"
  | "On Hold"
  | "Rejected"
  | "Consumed";

export type EntityStatusMeta = {
  color: string;
  icon: IconType;
  label: string;
};

export const ENTITY_STATUS_META: Record<EntityStatus, EntityStatusMeta> = {
  Available: {
    color: "hsl(142 71% 45%)",
    icon: LuPackageCheck,
    label: "Available"
  },
  Reserved: {
    color: "hsl(220 9% 46%)",
    icon: LuPackageOpen,
    label: "Reserved"
  },
  "On Hold": { color: "hsl(25 95% 53%)", icon: LuPause, label: "On Hold" },
  Rejected: { color: "hsl(0 84% 60%)", icon: LuPackageX, label: "Rejected" },
  Consumed: {
    color: "hsl(217 91% 60%)",
    icon: LuPackageMinus,
    label: "Consumed"
  }
};

export const DEFAULT_ENTITY_STATUS: EntityStatus = "Consumed";

export function entityStatusMeta(
  status: string | null | undefined
): EntityStatusMeta {
  return (
    ENTITY_STATUS_META[(status ?? DEFAULT_ENTITY_STATUS) as EntityStatus] ??
    ENTITY_STATUS_META[DEFAULT_ENTITY_STATUS]
  );
}

export type ActivityKind =
  | "Receipt"
  | "Manufacturing"
  | "Assembly"
  | "Shipment"
  | "Transfer"
  | "Rework"
  | "Inspection"
  | "Other";

export type ActivityKindMeta = {
  label: string;
  color: string;
  icon: IconType;
};

export const ACTIVITY_KIND_META: Record<ActivityKind, ActivityKindMeta> = {
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
