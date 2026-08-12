import { useControlField, useField } from "@carbon/form";
import {
  ChoiceSelect,
  type ChoiceSelectOption,
  FormControl,
  FormErrorMessage,
  FormLabel
} from "@carbon/react";
import {
  SURFACES_BY_TARGET_TYPE,
  TRANSACTION_SURFACES,
  type TransactionSurface
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import {
  LuArrowRightLeft,
  LuBlocks,
  LuScale,
  LuTruck,
  LuWarehouse
} from "react-icons/lu";

const SURFACE_META: Record<
  TransactionSurface,
  { title: string; description: string; icon: JSX.Element }
> = {
  receipt: {
    title: "Receipts",
    description: "When goods arrive at a location",
    icon: <LuTruck />
  },
  shipment: {
    title: "Shipments",
    description: "When goods leave a location",
    icon: <LuBlocks />
  },
  stockTransfer: {
    title: "Stock transfers",
    description: "When goods move between storage units",
    icon: <LuArrowRightLeft />
  },
  warehouseTransfer: {
    title: "Warehouse transfers",
    description: "When goods move between warehouses",
    icon: <LuWarehouse />
  },
  inventoryAdjustment: {
    title: "Inventory adjustments",
    description: "Manual quantity edits at a storage unit",
    icon: <LuScale />
  },
  place: {
    title: "Place",
    description: "When stock is placed into a storage unit",
    icon: <LuBlocks />
  },
  pick: {
    title: "Pick",
    description: "When stock is taken from a storage unit",
    icon: <LuBlocks />
  },
  operationStart: {
    title: "Operation start",
    description: "When an operator starts a job operation",
    icon: <LuArrowRightLeft />
  },
  operationFinish: {
    title: "Operation finish",
    description: "When an operator completes a job operation",
    icon: <LuArrowRightLeft />
  },
  materialIssue: {
    title: "Material issue",
    description: "When material is consumed by an operation",
    icon: <LuScale />
  },
  materialReceive: {
    title: "Material receive",
    description: "When material is returned from an operation",
    icon: <LuScale />
  }
};

export type SurfaceOption<S extends string = string> = {
  value: S;
  label: string;
  description?: string;
  icon?: JSX.Element;
};

type SurfacesFieldProps<S extends string> = {
  name: string;
  label?: string;
  targetType?: "item" | "workCenter";
  /**
   * Custom surface catalog (e.g. item-rule sales surfaces). When provided it
   * replaces the storage `TransactionSurface` catalog entirely and
   * `targetType` is ignored. Omit for storage rules — the default behavior
   * is unchanged.
   */
  surfaceOptions?: SurfaceOption<S>[];
  /**
   * Mirrors the live `value` to the parent so siblings (e.g. ConditionRow's
   * per-surface notes panel) can filter against the rule's actual surfaces
   * rather than every surface valid for the targetType. Identity untracked.
   */
  onSurfacesChange?: (next: S[]) => void;
};

/**
 * Multi-select for the rule's `surfaces` field. Uses ChoiceSelect's `multiple`
 * mode — same compact trigger style as the severity picker.
 *
 * Soft-guards against unchecking the last selected surface (zod `min(1)` is
 * the server-side backstop).
 */
export default function SurfacesField<S extends string = TransactionSurface>({
  name,
  label,
  targetType,
  surfaceOptions,
  onSurfacesChange
}: SurfacesFieldProps<S>) {
  const { t } = useLingui();
  const { error, isOptional } = useField(name);
  const [value, setValue] = useControlField<S[]>(name);
  const selected = value ?? [];

  // Mirror selection up to the form. Identity of `onSurfacesChange` not
  // tracked — parent wraps in `useCallback` if it needs stability.
  // biome-ignore lint/correctness/useExhaustiveDependencies: callback identity intentionally untracked
  useEffect(() => {
    onSurfacesChange?.(selected);
  }, [selected]);

  let options: ChoiceSelectOption<S>[];
  if (surfaceOptions) {
    options = surfaceOptions.map((o) => ({
      value: o.value,
      title: o.label,
      description: o.description,
      icon: o.icon
    }));
  } else {
    const allowed = targetType
      ? new Set<TransactionSurface>(SURFACES_BY_TARGET_TYPE[targetType])
      : null;
    const visibleSurfaces = allowed
      ? TRANSACTION_SURFACES.filter((s) => allowed.has(s))
      : TRANSACTION_SURFACES;

    // Default generic (S = TransactionSurface) makes this cast a no-op; it
    // only exists because TS can't see that the fallback branch implies the
    // default type parameter.
    options = visibleSurfaces.map((s) => ({
      value: s,
      title: SURFACE_META[s].title,
      description: SURFACE_META[s].description,
      icon: SURFACE_META[s].icon
    })) as unknown as ChoiceSelectOption<S>[];
  }

  const handleChange = (next: S[]) => {
    if (next.length === 0) return; // soft guard — keep at least one
    setValue(next);
  };

  return (
    <FormControl isInvalid={!!error}>
      <FormLabel isOptional={isOptional} htmlFor={name}>
        {label ?? t`Triggers`}
      </FormLabel>

      {selected.map((surface, index) => (
        <input
          key={surface}
          type="hidden"
          name={`${name}[${index}]`}
          value={surface}
        />
      ))}

      <ChoiceSelect<S>
        multiple
        value={selected}
        onChange={handleChange}
        options={options}
        placeholder={t`Select surfaces`}
        aria-label={label ?? t`Applies to`}
      />

      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
}
