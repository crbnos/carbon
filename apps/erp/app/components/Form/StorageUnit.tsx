// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// `<StorageUnit>` — the storage-unit (bin) picker. One component, two modes:
// - with `name`    -> form-bound (`@carbon/form` CreatableCombobox)
// - without `name` -> controlled (`value` + `onChange`) for table cells
//
// Options are the *leaf* storage units (the storable bins), each with a helper
// showing on-hand quantity (when `itemId` is given) or its hierarchy path.
// Built on the canonical `CreatableCombobox`, like every other entity picker.
//
// Choosing where a unit sits in the tree (a non-leaf target) is a different,
// single-purpose interaction handled by `StorageUnitParentSelect`, local to the
// Storage Unit form.

import type { TermId } from "@carbon/content/glossary";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { CreatableCombobox as CreatableComboboxBase } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { MouseEventHandler } from "react";
import { useCallback, useMemo, useRef } from "react";
import { useDrawerItem, useQuantityFormatter } from "~/hooks";
import { useNonNettableStorageUnits } from "~/hooks/useNonNettableStorageUnits";
import type { getStorageUnitsList } from "~/modules/inventory/inventory.service";
import StorageUnitForm from "~/modules/inventory/ui/StorageUnits/StorageUnitForm";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

// ---------------------------------------------------------------------------
// Data hooks (shared)
// ---------------------------------------------------------------------------

export type StorageUnitTreeRow = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  ancestorPath: string[];
};

/**
 * Recursive storage-unit tree for a single location. One round-trip per
 * locationId change; consumers cache by reference identity. Also used by the
 * parent picker and storage-rule value inputs.
 */
export function useStorageUnitsTree(locationId?: string | null) {
  const fetcher = useLoaderQuery<{
    data: StorageUnitTreeRow[] | null;
    error: unknown;
  }>(locationId ? path.to.api.storageUnitsTree(locationId) : null);

  return fetcher.data?.data ?? [];
}

/**
 * Flat storage-unit list for a location, optionally with per-item quantity
 * helpers. Kept for non-leaf-aware callsites that pull their own options.
 */
export function useStorageUnits(locationId?: string, itemId?: string) {
  const storageUnitsFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getStorageUnitsList>>
  >(locationId ? path.to.api.storageUnits(locationId) : null);
  const storageUnitsWithQuantitiesFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getStorageUnitsList>>
  >(
    locationId && itemId
      ? path.to.api.storageUnitsWithQuantities(locationId, itemId)
      : null,
    { staleTime: 0 }
  );

  const options = useMemo(() => {
    if (itemId && storageUnitsWithQuantitiesFetcher.data?.data) {
      const storageUnitsWithQuantities =
        storageUnitsWithQuantitiesFetcher.data.data;
      const allStorageUnits = storageUnitsFetcher.data?.data ?? [];

      const storageUnitIdsWithQuantities = new Set(
        storageUnitsWithQuantities.map((s: any) => s.id)
      );

      const storageUnitsWithoutQuantities = allStorageUnits.filter(
        (storageUnit: any) => !storageUnitIdsWithQuantities.has(storageUnit.id)
      );

      return [
        ...storageUnitsWithQuantities.map((c: any) => ({
          value: c.id,
          label: c.name,
          helper: `Qty: ${c.quantity}`
        })),
        ...storageUnitsWithoutQuantities.map((c: any) => ({
          value: c.id,
          label: c.name
        }))
      ];
    }

    return (
      storageUnitsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.name,
        // Add quantity as helper text if available
        // @ts-expect-error
        ...(c.quantity !== undefined && { helper: `Qty: ${c.quantity}` })
      })) ?? []
    );
  }, [
    storageUnitsFetcher.data,
    storageUnitsWithQuantitiesFetcher.data,
    itemId
  ]);

  return { options, data: storageUnitsFetcher.data };
}

type StorageUnitOption = { value: string; label: string; helper?: string };

/**
 * Per-unit on-hand quantities for `itemId`, keyed by storage-unit id, or null
 * until a request succeeds. Only fetches when both ids are present, so
 * item-less pickers don't pay for it.
 */
function useStorageUnitQuantities(locationId?: string | null, itemId?: string) {
  const fetcher = useLoaderQuery<{
    data: { id: string; quantity: number }[] | null;
    error: unknown;
  }>(
    locationId && itemId
      ? path.to.api.storageUnitsWithQuantities(locationId, itemId)
      : null,
    { staleTime: 0 }
  );

  return useMemo(() => {
    if (!fetcher.data?.data || fetcher.data.error) return null;
    const m = new Map<string, number>();
    for (const s of fetcher.data.data) m.set(s.id, s.quantity);
    return m;
  }, [fetcher.data]);
}

const NO_QUANTITIES = new Map<string, number>();

/**
 * Options for the leaf bins in a location (nodes with no children — the
 * storable locations). `helper` shows the on-hand quantity when `itemId` is
 * given, otherwise the hierarchy path to disambiguate same-named bins.
 */
export function useStorageUnitLeafOptions(
  locationId?: string | null,
  itemId?: string,
  {
    stockedFirst = false,
    stockedOnly = false,
    keepId,
    excludeId,
    storageUnits,
    quantities: knownQuantities
  }: {
    /**
     * Bins holding the item first (by quantity), then every other bin, each
     * of those with its hierarchy path. Every bin stays selectable.
     */
    stockedFirst?: boolean;
    stockedOnly?: boolean;
    keepId?: string | null;
    /** A bin that is never a valid choice here, e.g. a transfer's source. */
    excludeId?: string | null;
    /** The location's tree when the caller already has it: no fetch. */
    storageUnits?: StorageUnitTreeRow[];
    /** On-hand of `itemId` per storage unit when the caller has it: no fetch. */
    quantities?: Map<string, number>;
  } = {}
): StorageUnitOption[] {
  const fetchedRows = useStorageUnitsTree(storageUnits ? null : locationId);
  const rows = storageUnits ?? fetchedRows;
  const fetchedQuantities = useStorageUnitQuantities(
    knownQuantities ? null : locationId,
    itemId
  );
  const quantities = knownQuantities ?? fetchedQuantities ?? NO_QUANTITIES;
  const filterStocked =
    stockedOnly && !!itemId && (!!knownQuantities || !!fetchedQuantities);
  const formatQuantity = useQuantityFormatter();
  const nonNettable = useNonNettableStorageUnits();
  const { t } = useLingui();

  return useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const parentIds = new Set(
      rows.map((r) => r.parentId).filter((id): id is string => Boolean(id))
    );

    const options = rows
      .filter(
        (r) =>
          !parentIds.has(r.id) &&
          r.id !== excludeId &&
          (!filterStocked || r.id === keepId || (quantities.get(r.id) ?? 0) > 0)
      )
      .map((r) => {
        const ancestorPath = (r.ancestorPath ?? [])
          .slice(0, -1)
          .map((id) => byId.get(id)?.name)
          .filter(Boolean)
          .join(" / ");
        const quantity = quantities.get(r.id) ?? 0;
        const detail =
          itemId && (!stockedFirst || quantity !== 0)
            ? `Qty: ${formatQuantity(quantity)}`
            : ancestorPath || undefined;
        return {
          value: r.id,
          label: r.name,
          quantity,
          helper: nonNettable.has(r.id)
            ? [t`Non-nettable`, detail].filter(Boolean).join(" · ")
            : detail
        };
      })
      .sort((a, b) => {
        if (stockedFirst && (a.quantity !== 0) !== (b.quantity !== 0)) {
          return a.quantity !== 0 ? -1 : 1;
        }
        if (stockedFirst && a.quantity !== b.quantity) {
          return b.quantity - a.quantity;
        }
        return a.label.localeCompare(b.label);
      });
    return options.map(({ quantity: _quantity, ...option }) => option);
  }, [
    rows,
    quantities,
    itemId,
    stockedFirst,
    filterStocked,
    keepId,
    excludeId,
    formatQuantity,
    nonNettable,
    t
  ]);
}

// ---------------------------------------------------------------------------
// Create-new-unit flow
// ---------------------------------------------------------------------------

/**
 * Shared "+ New storage unit" flow. `onCreateOption` seeds the form with the
 * typed text; closing the modal re-clicks the trigger so the combobox reopens
 * with the freshly created unit selectable.
 */
function useNewStorageUnitModal(locationId?: string | null) {
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const node =
    create.item !== null && locationId ? (
      <StorageUnitForm
        key={create.key}
        open={create.isOpen}
        type="modal"
        locationId={locationId}
        onClose={() => {
          create.close();
          create.afterClose(() => triggerRef.current?.click());
        }}
        initialValues={{
          name: create.item,
          locationId,
          storageTypeIds: [],
          nonNettable: false
        }}
      />
    ) : null;

  const onCreateOption = (value: string) => {
    create.open(value);
  };

  const { open } = create;
  const onOpen = useCallback(() => open(""), [open]);

  return { triggerRef, onCreateOption, onOpen, node };
}

const storageUnitPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const match = options.find((o) => o.value === value);
  return <span className="text-sm">{match?.label ?? ""}</span>;
};

const labelToString = (label: string | JSX.Element) =>
  typeof label === "string" ? label : "";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type StorageUnitProps = {
  /** Provide `name` for form-bound usage; omit it for controlled usage. */
  name?: string;
  /** Form-mode seed value, or the controlled value when `name` is absent. */
  value?: string | null;
  label?: string;
  helperText?: string;
  placeholder?: string;
  isReadOnly?: boolean;
  isOptional?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  locationId?: string | null;
  itemId?: string;
  /** Glossary term wired to a `<LabelWithHelp>` info icon next to the label. */
  termId?: TermId;
  /** Render a compact inline preview (table cells) once a value is set. */
  inline?: boolean;
  /** Show the "+ New storage unit" create option. Defaults to `true`. */
  allowCreate?: boolean;
  /** List the bins holding `itemId` first; every other bin stays listed. */
  stockedFirst?: boolean;
  stockedOnly?: boolean;
  /** Leave one bin out of the options (a transfer's source). */
  excludeId?: string | null;
  /** The location's storage units, when the caller loaded them already. */
  storageUnits?: StorageUnitTreeRow[];
  /** On-hand of `itemId` per storage unit, when the caller has it. */
  quantities?: Map<string, number>;
  onChange?: (storageUnit: ListItem | null) => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

const toListItem = (id: string, options: StorageUnitOption[]): ListItem => ({
  id,
  name: labelToString(options.find((o) => o.value === id)?.label ?? "")
});

function StorageUnit({
  name,
  value,
  label,
  helperText,
  placeholder = "Select storage unit",
  isReadOnly,
  isOptional,
  disabled,
  className,
  onClick,
  locationId,
  itemId,
  termId,
  inline,
  allowCreate = true,
  stockedFirst,
  stockedOnly,
  excludeId,
  storageUnits,
  quantities,
  onChange,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy
}: StorageUnitProps) {
  const options = useStorageUnitLeafOptions(locationId, itemId, {
    stockedFirst,
    stockedOnly,
    keepId: value,
    excludeId,
    storageUnits,
    quantities
  });
  const { triggerRef, onCreateOption, onOpen, node } =
    useNewStorageUnitModal(locationId);
  const readOnly = isReadOnly || disabled;

  const emptyMessage = useEmptyState(
    "storageUnit",
    allowCreate && locationId ? { onCreate: onOpen } : undefined
  );

  if (name) {
    return (
      <>
        <CreatableCombobox
          ref={triggerRef}
          name={name}
          value={value ?? undefined}
          options={options}
          label={label ?? "Storage Unit"}
          termId={termId}
          helperText={helperText}
          placeholder={placeholder}
          isReadOnly={readOnly}
          isOptional={isOptional}
          className={className}
          onClick={onClick}
          inline={inline ? storageUnitPreview : undefined}
          emptyMessage={emptyMessage}
          onCreateOption={allowCreate ? onCreateOption : undefined}
          onChange={(option) =>
            onChange?.(
              option
                ? { id: option.value, name: labelToString(option.label) }
                : null
            )
          }
        />
        {node}
      </>
    );
  }

  if (!locationId) return null;

  return (
    <>
      <CreatableComboboxBase
        ref={triggerRef}
        aria-label={ariaLabel ?? label}
        aria-describedby={ariaDescribedBy}
        options={options}
        value={value ?? undefined}
        isReadOnly={readOnly}
        isClearable
        placeholder={placeholder}
        className={className}
        onClick={onClick}
        emptyMessage={emptyMessage}
        onCreateOption={allowCreate ? onCreateOption : undefined}
        onChange={(selected) =>
          onChange?.(selected ? toListItem(selected, options) : null)
        }
      />
      {node}
    </>
  );
}

StorageUnit.displayName = "StorageUnit";

export default StorageUnit;
