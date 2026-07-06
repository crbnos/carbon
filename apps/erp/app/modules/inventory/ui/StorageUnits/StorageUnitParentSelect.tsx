// Hierarchical parent-storage-unit picker — drill-down + breadcrumb + search.
// Local to the Storage Unit form: the only place a *non-leaf* unit is the
// target (choosing where a unit sits in the tree). Everywhere else picks a
// leaf bin via the shared `<StorageUnit>` combobox.
//
// Backed by the same `useStorageUnitsTree` data hook as `<StorageUnit>`.

import { useControlField, useField } from "@carbon/form";
import {
  cn,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuMapPin, LuX } from "react-icons/lu";
import { useFetcher } from "react-router";
import { useLocations } from "~/components/Form/Location";
import {
  type StorageUnitTreeRow,
  useStorageUnitsTree
} from "~/components/Form/StorageUnit";
import { path } from "~/utils/path";

// ---------------------------------------------------------------------------
// useExcludedDescendantIds — fetches the subtree under `rootId` so the picker
// can exclude self + descendants (cycle prevention). DB also enforces this via
// `storage_unit_enforce_no_cycle`.
// ---------------------------------------------------------------------------

function useExcludedDescendantIds(rootId?: string): Set<string> {
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
// Controlled drill-down
// ---------------------------------------------------------------------------

type DrillSelectProps = {
  locationId: string | null | undefined;
  value: string | null | undefined;
  onChange: (id: string) => void;
  isReadOnly?: boolean;
  placeholder?: string;
  excludeDescendantsOf?: string;
};

function DrillSelect({
  locationId,
  value,
  onChange,
  isReadOnly,
  placeholder = "Select",
  excludeDescendantsOf
}: DrillSelectProps) {
  const allRows = useStorageUnitsTree(locationId);
  const excludedIds = useExcludedDescendantIds(excludeDescendantsOf);
  const rows = useMemo(
    () =>
      excludedIds.size === 0
        ? allRows
        : allRows.filter((r) => !excludedIds.has(r.id)),
    [allRows, excludedIds]
  );
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<string[]>([]);
  const [search, setSearch] = useState("");

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
    onChange(id);
    setOpen(false);
    reset();
  };

  if (!locationId) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isReadOnly}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm text-left shadow-xs transition-[color,box-shadow]",
            "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            isReadOnly && "opacity-60 cursor-not-allowed",
            !triggerLabel && "text-muted-foreground"
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
        {/* Breadcrumb — root crumb = location, non-clickable (single-location);
            subsequent crumbs are parent units (clickable to navigate up). */}
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
                <li key={row.id} className="flex items-stretch hover:bg-muted">
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
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Form-bound parent picker
// ---------------------------------------------------------------------------

type StorageUnitParentSelectProps = {
  name: string;
  label?: string;
  helperText?: string;
  locationId: string | null | undefined;
  isReadOnly?: boolean;
  isOptional?: boolean;
  /** Exclude this unit and its descendants (cycle prevention). */
  excludeDescendantsOf?: string;
};

export function StorageUnitParentSelect({
  name,
  label,
  helperText,
  locationId,
  isReadOnly,
  isOptional,
  excludeDescendantsOf
}: StorageUnitParentSelectProps) {
  const { error, getInputProps, isOptional: fieldIsOptional } = useField(name);
  const [value, setValue] = useControlField<string | undefined>(name);

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
      <DrillSelect
        locationId={locationId}
        value={value ?? null}
        onChange={(next) => setValue(next || undefined)}
        isReadOnly={isReadOnly}
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
