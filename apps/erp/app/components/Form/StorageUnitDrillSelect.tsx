// Hierarchical (drill-down + breadcrumb + search) storage-unit picker.
// Backed by `storageUnits_recursive` so children render under their parent.
//
// Two exports:
// - `StorageUnitDrillSelect` — controlled (value/onChange). Use in any
//   non-form context (table cells, custom controllers).
// - `StorageUnitDrillSelectField` — bound to `@carbon/form` via
//   `useControlField` + `useField`. Drop-in replacement for the flat
//   `<Combobox name="..." />` inside a `ValidatedForm`.

import { useControlField, useField } from "@carbon/form";
import {
  cn,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuMapPin,
  LuPlus,
  LuSettings2,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import StorageUnitForm from "~/modules/inventory/ui/StorageUnits/StorageUnitForm";
import { path } from "~/utils/path";
import { useLocations } from "./Location";

export type StorageUnitTreeRow = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  ancestorPath: string[];
};

/**
 * Fetches the recursive tree for a single location. One round-trip per
 * locationId change; consumers cache by reference identity.
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

type StorageUnitDrillSelectProps = {
  locationId: string | null | undefined;
  value: string | null | undefined;
  onChange: (id: string, row?: StorageUnitTreeRow) => void;
  isReadOnly?: boolean;
  /** Show "+ New storage unit" footer. Defaults to `true`. */
  allowCreate?: boolean;
  placeholder?: string;
  className?: string;
  /**
   * Exclude the given unit and all its descendants from the tree. Used by
   * parent-pickers so a user can't pick themselves / a child (cycle). DB
   * also enforces via `storage_unit_enforce_no_cycle`.
   */
  excludeDescendantsOf?: string;
};

export function StorageUnitDrillSelect({
  locationId,
  value,
  onChange,
  isReadOnly,
  allowCreate = true,
  placeholder = "Select",
  className,
  excludeDescendantsOf
}: StorageUnitDrillSelectProps) {
  const allRows = useStorageUnitsTree(locationId);
  const excludedIds = useExcludedDescendantIds(excludeDescendantsOf);
  const rows = useMemo(
    () =>
      excludedIds.size === 0
        ? allRows
        : allRows.filter((r) => !excludedIds.has(r.id)),
    [allRows, excludedIds]
  );
  const newStorageUnitModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const byId = useMemo(() => {
    const m = new Map<string, StorageUnitTreeRow>();
    rows.forEach((r) => {
      m.set(r.id, r);
    });
    return m;
  }, [rows]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, StorageUnitTreeRow[]>();
    rows.forEach((r) => {
      const arr = m.get(r.parentId) ?? [];
      arr.push(r);
      m.set(r.parentId, arr);
    });
    m.forEach((arr) => {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    });
    return m;
  }, [rows]);

  const currentParentId = stack.length === 0 ? null : stack[stack.length - 1];
  const currentChildren = childrenOf.get(currentParentId) ?? [];
  const breadcrumb = stack
    .map((id) => byId.get(id))
    .filter((r): r is StorageUnitTreeRow => Boolean(r));

  const renderPath = useCallback(
    (row: StorageUnitTreeRow) =>
      (row.ancestorPath ?? [])
        .slice(0, -1)
        .map((id) => byId.get(id)?.name)
        .filter(Boolean)
        .join(" / "),
    [byId]
  );

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return rows.filter((r) => {
      if (r.name?.toLowerCase().includes(q)) return true;
      return (r.ancestorPath ?? []).some((id) =>
        byId.get(id)?.name?.toLowerCase().includes(q)
      );
    });
  }, [search, rows, byId]);

  const selectedRow = value ? byId.get(value) : undefined;
  const triggerLabel = selectedRow?.name ?? "";

  // Look up the current location's name for the breadcrumb root.
  const locations = useLocations();
  const locationLabel = useMemo(() => {
    const match = locations.find((l) => l.value === locationId);
    return match ? (typeof match.label === "string" ? match.label : "") : "";
  }, [locations, locationId]);

  // Open with the selected row's parent stack so the user sees the selected
  // unit highlighted in its sibling list on reopen.
  useEffect(() => {
    if (!open) return;
    if (!value) return;
    const row = byId.get(value);
    if (!row) return;
    setStack((row.ancestorPath ?? []).slice(0, -1));
  }, [open, value, byId]);

  const reset = () => {
    setStack([]);
    setSearch("");
  };

  const select = (id: string) => {
    onChange(id, id ? byId.get(id) : undefined);
    setOpen(false);
    reset();
  };

  if (!locationId) return null;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            disabled={isReadOnly}
            className={cn(
              "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm text-left shadow-xs transition-[color,box-shadow]",
              "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              isReadOnly && "opacity-60 cursor-not-allowed",
              !triggerLabel && "text-muted-foreground",
              className
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {triggerLabel || placeholder}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {value && !isReadOnly ? (
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label="Clear"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange("");
                  }}
                  className="flex h-4 w-4 items-center justify-center rounded opacity-60 hover:bg-muted hover:opacity-100"
                >
                  <LuX className="h-3 w-3" />
                </span>
              ) : null}
              <LuChevronDown className="h-4 w-4 opacity-50" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          collisionPadding={12}
          avoidCollisions
          className="w-auto min-w-[280px] max-w-[min(420px,calc(100vw-24px))] p-0"
        >
          {/* Breadcrumb — always visible. Root crumb = location, non-clickable
              (DrillSelect is single-location); subsequent crumbs are parent
              units (clickable to navigate up the tree). */}
          <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5">
            <button
              type="button"
              onClick={() => setStack([])}
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-muted",
                stack.length === 0
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LuMapPin className="h-3 w-3 opacity-70" />
              {locationLabel || "Location"}
            </button>
            {breadcrumb.map((row, i) => (
              <span key={row.id} className="flex items-center gap-0.5">
                <LuChevronRight className="h-3 w-3 text-muted-foreground/60" />
                <button
                  type="button"
                  onClick={() => setStack(stack.slice(0, i + 1))}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs hover:bg-muted",
                    i === breadcrumb.length - 1
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {row.name}
                </button>
              </span>
            ))}
          </div>

          {/* Search — flush, borderless. */}
          <Input
            autoFocus
            borderless
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search storage units…"
            className="h-9 rounded-none border-b border-border bg-transparent px-3 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          />

          {/* List */}
          <ul className="max-h-[260px] overflow-y-auto py-1">
            {searchResults ? (
              searchResults.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No matches
                </li>
              ) : (
                searchResults.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => select(row.id)}
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-muted"
                    >
                      <span className="text-sm">{row.name}</span>
                      {renderPath(row) && (
                        <span className="text-xs text-muted-foreground">
                          {renderPath(row)}
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )
            ) : currentChildren.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                No storage units
              </li>
            ) : (
              currentChildren.map((row) => {
                const hasChildren = (childrenOf.get(row.id) ?? []).length > 0;
                const isSelected = row.id === value;
                return (
                  <li
                    key={row.id}
                    className="flex items-stretch hover:bg-muted"
                  >
                    <button
                      type="button"
                      onClick={() => select(row.id)}
                      className={cn(
                        "flex-1 truncate px-3 py-1.5 text-left text-sm",
                        isSelected && "font-medium text-foreground"
                      )}
                    >
                      {row.name}
                    </button>
                    {hasChildren && (
                      <button
                        type="button"
                        onClick={() => {
                          setStack([...stack, row.id]);
                          setSearch("");
                        }}
                        className="flex w-7 shrink-0 items-center justify-center border-l text-muted-foreground hover:text-foreground"
                        aria-label={`Open ${row.name}`}
                      >
                        <LuChevronRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })
            )}
          </ul>

          {allowCreate && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                reset();
                newStorageUnitModal.onOpen();
                setCreated(search);
              }}
              className="flex w-full items-center gap-1 border-t border-border px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <span className="text-sm leading-none">+</span>
              New storage unit{search ? `: "${search}"` : ""}
            </button>
          )}
        </PopoverContent>
      </Popover>
      {newStorageUnitModal.isOpen && (
        <StorageUnitForm
          locationId={locationId}
          type="modal"
          onClose={() => {
            setCreated("");
            newStorageUnitModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            locationId: locationId,
            storageTypeIds: []
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// useExcludedDescendantIds — fetches the subtree under `rootId` so a
// parent-picker can exclude self + descendants (cycle prevention).
// ---------------------------------------------------------------------------

export function useExcludedDescendantIds(rootId?: string): Set<string> {
  const descendantsFetcher = useFetcher<{ data: { id: string }[] }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity changes every render
  useEffect(() => {
    if (rootId) {
      descendantsFetcher.load(path.to.api.storageUnitDescendants(rootId));
    }
  }, [rootId]);

  return useMemo(() => {
    if (!rootId) return new Set<string>();
    const ids = new Set<string>([rootId]);
    for (const row of descendantsFetcher.data?.data ?? []) {
      if (row.id) ids.add(row.id);
    }
    return ids;
  }, [rootId, descendantsFetcher.data]);
}

// ---------------------------------------------------------------------------
// Form-aware variant — binds to `@carbon/form` via name + hidden input.
// ---------------------------------------------------------------------------

type StorageUnitDrillSelectFieldProps = {
  name: string;
  label?: string;
  inline?: boolean;
  helperText?: string;
  locationId: string | null | undefined;
  isReadOnly?: boolean;
  isOptional?: boolean;
  allowCreate?: boolean;
  placeholder?: string;
  className?: string;
  excludeDescendantsOf?: string;
  /**
   * Callback fired after the form value updates. Receives the chosen row so
   * callers that need name/parent metadata don't have to re-fetch. `null` on
   * clear.
   */
  onChange?: (row: StorageUnitTreeRow | null) => void;
};

export function StorageUnitDrillSelectField({
  name,
  label,
  inline = false,
  helperText,
  locationId,
  isReadOnly,
  isOptional,
  allowCreate,
  placeholder,
  className,
  excludeDescendantsOf,
  onChange
}: StorageUnitDrillSelectFieldProps) {
  const { error, getInputProps, isOptional: fieldIsOptional } = useField(name);
  const [value, setValue] = useControlField<string | undefined>(name);
  const [inlineMode, setInlineMode] = useState(inline);
  const rows = useStorageUnitsTree(locationId);
  const displayName = rows.find((r) => r.id === value)?.name ?? "";

  if (inlineMode) {
    return (
      <VStack spacing={0}>
        {label && (
          <span className="text-xs text-muted-foreground">{label}</span>
        )}
        <input type="hidden" name={name} value={value ?? ""} />
        <HStack spacing={0} className="w-full justify-between">
          {displayName && (
            <span className="flex-grow text-sm line-clamp-1">
              {displayName}
            </span>
          )}
          <IconButton
            icon={displayName ? <LuSettings2 /> : <LuPlus />}
            aria-label={displayName ? "Edit" : "Add"}
            size="sm"
            variant="secondary"
            isDisabled={isReadOnly}
            onClick={() => setInlineMode(false)}
          />
        </HStack>
      </VStack>
    );
  }

  return (
    <FormControl isInvalid={!!error}>
      {label && (
        <FormLabel htmlFor={name} isOptional={isOptional ?? fieldIsOptional}>
          {label}
        </FormLabel>
      )}
      <input
        {...getInputProps({ id: name, type: "hidden" })}
        name={name}
        value={value ?? ""}
      />
      <StorageUnitDrillSelect
        locationId={locationId}
        value={value ?? null}
        onChange={(next, row) => {
          setValue(next || undefined);
          onChange?.(next ? (row ?? null) : null);
          if (inline) setInlineMode(true);
        }}
        isReadOnly={isReadOnly}
        allowCreate={allowCreate}
        placeholder={placeholder}
        className={className}
        excludeDescendantsOf={excludeDescendantsOf}
      />
      {error ? (
        <FormErrorMessage>{error}</FormErrorMessage>
      ) : (
        helperText && <FormHelperText>{helperText}</FormHelperText>
      )}
    </FormControl>
  );
}
