import { cn } from "@carbon/react";
import {
  SURFACES_BY_TARGET_TYPE,
  type TargetType,
  TRANSACTION_SURFACES,
  type TransactionSurface
} from "@carbon/utils";
import {
  LuArrowRightLeft,
  LuBlocks,
  LuScale,
  LuTruck,
  LuWarehouse
} from "react-icons/lu";

const SURFACE_VISUALS: Record<
  TransactionSurface,
  { label: string; icon: JSX.Element }
> = {
  receipt: { label: "Receipts", icon: <LuTruck className="size-3.5" /> },
  shipment: { label: "Shipments", icon: <LuBlocks className="size-3.5" /> },
  stockTransfer: {
    label: "Stock transfers",
    icon: <LuArrowRightLeft className="size-3.5" />
  },
  warehouseTransfer: {
    label: "Warehouse transfers",
    icon: <LuWarehouse className="size-3.5" />
  },
  inventoryAdjustment: {
    label: "Inventory adjustments",
    icon: <LuScale className="size-3.5" />
  },
  place: { label: "Place", icon: <LuBlocks className="size-3.5" /> },
  pick: { label: "Pick", icon: <LuBlocks className="size-3.5" /> },
  operationStart: {
    label: "Operation start",
    icon: <LuArrowRightLeft className="size-3.5" />
  },
  operationFinish: {
    label: "Operation finish",
    icon: <LuArrowRightLeft className="size-3.5" />
  },
  materialIssue: {
    label: "Material issue",
    icon: <LuScale className="size-3.5" />
  },
  materialReceive: {
    label: "Material receive",
    icon: <LuScale className="size-3.5" />
  }
};

type SurfaceChipsProps = {
  surfaces: TransactionSurface[] | null | undefined;
  /**
   * When provided, the chip rail renders only surfaces valid for this
   * targetType (instead of all 11). Inactive surfaces within the target's
   * set are still shown at reduced opacity so the operator can scan
   * subscribed vs. skipped at a glance.
   */
  targetType?: TargetType;
  className?: string;
};

export default function SurfaceChips({
  surfaces,
  targetType,
  className
}: SurfaceChipsProps) {
  // Scope rendered set to the targetType's valid surfaces; fall back to all
  // when no targetType is supplied (callers that haven't been updated yet).
  const universe = targetType
    ? SURFACES_BY_TARGET_TYPE[targetType]
    : TRANSACTION_SURFACES;

  const active = new Set(surfaces && surfaces.length > 0 ? surfaces : universe);

  return (
    <div
      className={cn("flex items-center gap-1 text-muted-foreground", className)}
      role="group"
      aria-label="Transaction surfaces"
    >
      {universe.map((s) => {
        const meta = SURFACE_VISUALS[s];
        const isOn = active.has(s);
        return (
          <span
            key={s}
            title={`${meta.label}${isOn ? "" : " (off)"}`}
            className={cn(
              "flex size-5 items-center justify-center rounded",
              isOn ? "bg-muted text-foreground" : "opacity-30"
            )}
          >
            {meta.icon}
          </span>
        );
      })}
    </div>
  );
}
