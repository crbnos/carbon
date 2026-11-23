// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import type { ReactNode } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import { FaCodePullRequest } from "react-icons/fa6";
import {
  LuBarcode,
  LuBox,
  LuFlaskConical,
  LuGroup,
  LuShoppingCart,
  LuSquare
} from "react-icons/lu";
import { RxCodesandboxLogo } from "react-icons/rx";
import { TbTargetOff } from "react-icons/tb";
import type {
  ItemEdit,
  ItemFieldSnapshot,
  ItemMethodType,
  ItemReplenishmentSystem,
  ItemTrackingType
} from "./plan";
import {
  ITEM_REPLENISHMENT_SYSTEMS,
  ITEM_TRACKING_TYPES,
  methodForReplenishment,
  reconcileMethodForReplenishment,
  VALID_METHOD_TYPES_BY_REPLENISHMENT
} from "./plan";

// Icons mirror apps/erp/app/components/Icons.tsx; @carbon/ee cannot import app code.
function replenishmentIcon(value: string): ReactNode {
  switch (value) {
    case "Buy":
      return <LuShoppingCart className="size-3.5 text-blue-500" />;
    case "Make":
      return <RxCodesandboxLogo className="size-3.5 text-emerald-500" />;
    case "Buy and Make":
      return <LuFlaskConical className="size-3.5 text-teal-500" />;
    default:
      return <LuSquare className="size-3.5 text-muted-foreground" />;
  }
}

function methodIcon(value: string): ReactNode {
  switch (value) {
    case "Purchase to Order":
      return <LuShoppingCart className="size-3.5 text-blue-500" />;
    case "Make to Order":
      return <RxCodesandboxLogo className="size-3.5 text-emerald-500" />;
    case "Pull from Inventory":
      return <FaCodePullRequest className="size-3.5 text-yellow-500" />;
    default:
      return <AiOutlinePartition className="size-3.5 text-muted-foreground" />;
  }
}

function trackingIcon(value: string): ReactNode {
  switch (value) {
    case "Serial":
      return <LuBarcode className="size-3.5" />;
    case "Batch":
      return <LuGroup className="size-3.5 text-emerald-500" />;
    case "Inventory":
      return <LuBox className="size-3.5 text-blue-500" />;
    case "Non-Inventory":
      return <TbTargetOff className="size-3.5 text-red-500" />;
    default:
      return <LuSquare className="size-3.5 text-muted-foreground" />;
  }
}

// The items table's secondary Badge, as a select trigger.
const FIELD_PILL =
  "inline-flex h-6 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-transparent px-2 text-foreground/70 outline-none transition-[background-color,box-shadow] hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-accent dark:border-border dark:text-secondary-foreground";

function FieldSelect<T extends string>({
  label,
  value,
  options,
  icon,
  disabled,
  onChange
}: {
  label: string;
  value: T;
  options: readonly T[];
  icon: (value: string) => ReactNode;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as T)}
      disabled={disabled}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0">
            <SelectTrigger
              inline
              aria-label={`${label}: ${value}`}
              className={FIELD_PILL}
            >
              {icon(value)}
            </SelectTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {label}: {value}
        </TooltipContent>
      </Tooltip>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            <span className="flex items-center gap-2">
              {icon(option)}
              <span>{option}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Replenishment, Method and Tracking selects as icon pills. onChange reports
 * only what the user changes.
 */
export function ItemFieldSelects({
  baseline,
  existing,
  edit,
  disabled,
  className,
  onChange
}: {
  className?: string;
  /** The create proposal, the "everyPush" target, or the item's current values. */
  baseline: ItemFieldSnapshot;
  /** In Carbon: a Replenishment change sets the method as the item page does; else as the Part form does. */
  existing?: boolean;
  edit: ItemEdit | undefined;
  disabled?: boolean;
  onChange: (patch: Partial<ItemFieldSnapshot>) => void;
}) {
  const replenishmentSystem =
    (edit?.replenishmentSystem as ItemReplenishmentSystem | undefined) ??
    baseline.replenishmentSystem;
  const defaultMethodType =
    (edit?.defaultMethodType as ItemMethodType | undefined) ??
    baseline.defaultMethodType;
  const itemTrackingType =
    (edit?.itemTrackingType as ItemTrackingType | undefined) ??
    baseline.itemTrackingType;

  return (
    <div className={cn("mt-1.5 flex items-center gap-1", className)}>
      <FieldSelect
        label="Replenishment"
        value={replenishmentSystem}
        options={ITEM_REPLENISHMENT_SYSTEMS}
        icon={replenishmentIcon}
        disabled={disabled}
        onChange={(next) =>
          // Send both so the apply never sees an illegal pair.
          onChange({
            replenishmentSystem: next,
            defaultMethodType: existing
              ? methodForReplenishment(next, defaultMethodType)
              : reconcileMethodForReplenishment(next, defaultMethodType)
          })
        }
      />
      <FieldSelect
        label="Method"
        value={defaultMethodType}
        options={VALID_METHOD_TYPES_BY_REPLENISHMENT[replenishmentSystem]}
        icon={methodIcon}
        disabled={disabled}
        onChange={(next) => onChange({ defaultMethodType: next })}
      />
      <FieldSelect
        label="Tracking"
        value={itemTrackingType}
        options={ITEM_TRACKING_TYPES}
        icon={trackingIcon}
        disabled={disabled}
        onChange={(next) => onChange({ itemTrackingType: next })}
      />
    </div>
  );
}
