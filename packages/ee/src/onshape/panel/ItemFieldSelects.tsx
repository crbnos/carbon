import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger
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
  reconcileMethodForReplenishment,
  VALID_METHOD_TYPES_BY_REPLENISHMENT
} from "./plan";

/**
 * The three Carbon-side manufacturing attributes a push sets on an item, as a
 * row of compact icon-only dropdowns.
 *
 * The panel is about twenty rows tall and a review can run to hundreds, so the
 * trigger shows only the value's icon (`hideIcon` drops the chevron); the label
 * lives in the open list and in the trigger's title/aria-label. Icons mirror the
 * ERP's own (`apps/erp/app/components/Icons.tsx`) — replicated here from
 * `react-icons` because `@carbon/ee` cannot import app code.
 *
 * The editor is seeded from `baseline` — the proposal for a created item, the
 * item's current values for an existing one — and reports only what the user
 * changes through `onChange`; the apply routes diff against the live value, so
 * an untouched control writes nothing.
 */

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
      {/* Icon-only trigger: the value's meaning is in the title/aria-label and
          in the open list, so a row of three stays narrow. */}
      <SelectTrigger
        size="sm"
        hideIcon
        aria-label={`${label}: ${value}`}
        title={`${label}: ${value}`}
        className="h-7 w-auto shrink-0 gap-0 px-1.5"
      >
        {icon(value)}
      </SelectTrigger>
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

export function ItemFieldSelects({
  baseline,
  edit,
  disabled,
  onChange
}: {
  /** Proposal (create) or the item's current values (existing). */
  baseline: ItemFieldSnapshot;
  /** The user's edit for this row so far, if any. */
  edit: ItemEdit | undefined;
  disabled?: boolean;
  /** Called with the field(s) the user changed. */
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
    <div className="mt-1.5 flex items-center gap-1">
      <FieldSelect
        label="Replenishment"
        value={replenishmentSystem}
        options={ITEM_REPLENISHMENT_SYSTEMS}
        icon={replenishmentIcon}
        disabled={disabled}
        onChange={(next) =>
          // Changing replenishment can invalidate the method, so reconcile it
          // to a legal one — the same interlock the ERP's Part form enforces —
          // and send both so the apply never sees an illegal pair.
          onChange({
            replenishmentSystem: next,
            defaultMethodType: reconcileMethodForReplenishment(
              next,
              defaultMethodType
            )
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
