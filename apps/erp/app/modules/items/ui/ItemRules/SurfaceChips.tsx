import { cn } from "@carbon/react";
import { TRANSACTION_SURFACES, type TransactionSurface } from "@carbon/utils";
import {
  LuArrowRightLeft,
  LuPackage,
  LuScale,
  LuTruck,
  LuWarehouse
} from "react-icons/lu";

const SURFACE_VISUALS: Record<
  TransactionSurface,
  { label: string; icon: JSX.Element }
> = {
  receipt: { label: "Receipts", icon: <LuTruck className="size-3.5" /> },
  shipment: { label: "Shipments", icon: <LuPackage className="size-3.5" /> },
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
  }
};

type SurfaceChipsProps = {
  surfaces: TransactionSurface[] | null | undefined;
  className?: string;
};

/**
 * Compact icon-only chips for the 4 transaction surfaces. Active surfaces
 * render at full opacity; inactive ones at 30% — letting an operator scan
 * "this rule fires on receipts + shipments" without opening the rule.
 *
 * Each chip carries a `title` attribute for accessibility/native tooltip.
 */
export default function SurfaceChips({
  surfaces,
  className
}: SurfaceChipsProps) {
  // Empty / null → treat as "all surfaces" (legacy rules pre-migration).
  const active = new Set(
    surfaces && surfaces.length > 0 ? surfaces : TRANSACTION_SURFACES
  );
  return (
    <div
      className={cn("flex items-center gap-1 text-muted-foreground", className)}
      role="group"
      aria-label="Transaction surfaces"
    >
      {TRANSACTION_SURFACES.map((s) => {
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
