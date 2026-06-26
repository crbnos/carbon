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

import { CreatableCombobox } from "@carbon/form";
import type { TermId } from "@carbon/glossary";
import {
  CreatableCombobox as CreatableComboboxBase,
  useDisclosure
} from "@carbon/react";
import type { MouseEventHandler } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { getStorageUnitsList } from "~/modules/inventory";
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
  const fetcher = useFetcher<{
    data: StorageUnitTreeRow[] | null;
    error: unknown;
  }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity changes every render
  useEffect(() => {
    if (locationId) fetcher.load(path.to.api.storageUnitsTree(locationId));
  }, [locationId]);

  return fetcher.data?.data ?? [];
}

/**
 * Flat storage-unit list for a location, optionally with per-item quantity
 * helpers. Kept for non-leaf-aware callsites that pull their own options.
 */
export function useStorageUnits(locationId?: string, itemId?: string) {
  const storageUnitsFetcher =
    useFetcher<Awaited<ReturnType<typeof getStorageUnitsList>>>();
  const storageUnitsWithQuantitiesFetcher =
    useFetcher<Awaited<ReturnType<typeof getStorageUnitsList>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (locationId) {
      if (itemId) {
        storageUnitsWithQuantitiesFetcher.load(
          path.to.api.storageUnitsWithQuantities(locationId, itemId)
        );
      }
      storageUnitsFetcher.load(path.to.api.storageUnits(locationId));
    }
  }, [locationId, itemId]);

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
 * Per-unit on-hand quantities for `itemId`, keyed by storage-unit id. Only
 * fetches when both ids are present, so item-less pickers don't pay for it.
 */
function useStorageUnitQuantities(locationId?: string | null, itemId?: string) {
  const fetcher = useFetcher<{ data: { id: string; quantity: number }[] }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity changes every render
  useEffect(() => {
    if (locationId && itemId) {
      fetcher.load(path.to.api.storageUnitsWithQuantities(locationId, itemId));
    }
  }, [locationId, itemId]);

  return useMemo(() => {
    const m = new Map<string, number>();
    for (const s of fetcher.data?.data ?? []) m.set(s.id, s.quantity);
    return m;
  }, [fetcher.data]);
}

/**
 * Options for the leaf bins in a location (nodes with no children — the
 * storable locations). `helper` shows the on-hand quantity when `itemId` is
 * given, otherwise the hierarchy path to disambiguate same-named bins.
 */
export function useStorageUnitLeafOptions(
  locationId?: string | null,
  itemId?: string
): StorageUnitOption[] {
  const rows = useStorageUnitsTree(locationId);
  const quantities = useStorageUnitQuantities(locationId, itemId);

  return useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const parentIds = new Set(
      rows.map((r) => r.parentId).filter((id): id is string => Boolean(id))
    );

    return rows
      .filter((r) => !parentIds.has(r.id))
      .map((r) => {
        const ancestorPath = (r.ancestorPath ?? [])
          .slice(0, -1)
          .map((id) => byId.get(id)?.name)
          .filter(Boolean)
          .join(" / ");
        return {
          value: r.id,
          label: r.name,
          helper: itemId
            ? `Qty: ${quantities.get(r.id) ?? 0}`
            : ancestorPath || undefined
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, quantities, itemId]);
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
  const modal = useDisclosure();
  const [created, setCreated] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const node =
    modal.isOpen && locationId ? (
      <StorageUnitForm
        type="modal"
        locationId={locationId}
        onClose={() => {
          setCreated("");
          modal.onClose();
          triggerRef.current?.click();
        }}
        initialValues={{ name: created, locationId, storageTypeIds: [] }}
      />
    ) : null;

  const onCreateOption = (value: string) => {
    setCreated(value);
    modal.onOpen();
  };

  return { triggerRef, onCreateOption, onOpen: modal.onOpen, node };
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
  onChange?: (storageUnit: ListItem | null) => void;
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
  onChange
}: StorageUnitProps) {
  const options = useStorageUnitLeafOptions(locationId, itemId);
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
