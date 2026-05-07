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
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useDisclosure
} from "@carbon/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuX } from "react-icons/lu";
import { useFetcher } from "react-router";
import StorageUnitForm from "~/modules/inventory/ui/StorageUnits/StorageUnitForm";
import { path } from "~/utils/path";

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
  onChange: (id: string) => void;
  isReadOnly?: boolean;
  /** Show "+ New storage unit" footer. Defaults to `true`. */
  allowCreate?: boolean;
  placeholder?: string;
  className?: string;
};

export function StorageUnitDrillSelect({
  locationId,
  value,
  onChange,
  isReadOnly,
  allowCreate = true,
  placeholder = "Select",
  className
}: StorageUnitDrillSelectProps) {
  const rows = useStorageUnitsTree(locationId);
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
              "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm text-left",
              "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isReadOnly && "opacity-60 cursor-not-allowed",
              !triggerLabel && "text-muted-foreground",
              className
            )}
          >
            <span className="truncate">{triggerLabel || placeholder}</span>
            {value && !isReadOnly ? (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                }}
                className="flex h-4 w-4 items-center justify-center rounded hover:bg-muted"
              >
                <LuX className="h-3 w-3" />
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
            <button
              type="button"
              onClick={() => setStack([])}
              className={cn(
                "rounded px-1.5 py-0.5 text-xs hover:bg-muted",
                stack.length === 0
                  ? "text-foreground font-medium"
                  : "text-muted-foreground"
              )}
            >
              All
            </button>
            {breadcrumb.map((row, i) => (
              <span key={row.id} className="flex items-center gap-1">
                <span className="text-muted-foreground text-xs">/</span>
                <button
                  type="button"
                  onClick={() => setStack(stack.slice(0, i + 1))}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs hover:bg-muted",
                    i === breadcrumb.length - 1
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {row.name}
                </button>
              </span>
            ))}
          </div>
          <div className="border-b px-2 py-1.5">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-7 text-sm"
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto py-1">
            {searchResults ? (
              searchResults.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No matches
                </div>
              ) : (
                searchResults.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => select(row.id)}
                    className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span>{row.name}</span>
                    {renderPath(row) && (
                      <span className="text-xs text-muted-foreground">
                        {renderPath(row)}
                      </span>
                    )}
                  </button>
                ))
              )
            ) : currentChildren.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No storage units
              </div>
            ) : (
              currentChildren.map((row) => {
                const hasChildren = (childrenOf.get(row.id) ?? []).length > 0;
                return (
                  <div
                    key={row.id}
                    className="flex items-stretch hover:bg-muted"
                  >
                    <button
                      type="button"
                      onClick={() => select(row.id)}
                      className="flex-1 px-3 py-1.5 text-left text-sm"
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
                        className="flex w-7 items-center justify-center border-l text-muted-foreground hover:text-foreground"
                        aria-label={`Open ${row.name}`}
                      >
                        ›
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {allowCreate && (
            <div className="border-t px-2 py-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                  newStorageUnitModal.onOpen();
                  setCreated(search);
                }}
                className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
              >
                + New storage unit{search ? `: "${search}"` : ""}
              </button>
            </div>
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
// Form-aware variant — binds to `@carbon/form` via name + hidden input.
// ---------------------------------------------------------------------------

type StorageUnitDrillSelectFieldProps = {
  name: string;
  label?: string;
  helperText?: string;
  locationId: string | null | undefined;
  isReadOnly?: boolean;
  allowCreate?: boolean;
  placeholder?: string;
  className?: string;
};

export function StorageUnitDrillSelectField({
  name,
  label,
  helperText,
  locationId,
  isReadOnly,
  allowCreate,
  placeholder,
  className
}: StorageUnitDrillSelectFieldProps) {
  const { error, getInputProps } = useField(name);
  const [value, setValue] = useControlField<string | undefined>(name);

  return (
    <FormControl isInvalid={!!error}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      {/* Hidden input so the form serialises the chosen id on submit. */}
      <input
        {...getInputProps({ id: name, type: "hidden" })}
        name={name}
        value={value ?? ""}
      />
      <StorageUnitDrillSelect
        locationId={locationId}
        value={value ?? null}
        onChange={(next) => setValue(next || undefined)}
        isReadOnly={isReadOnly}
        allowCreate={allowCreate}
        placeholder={placeholder}
        className={className}
      />
      {error ? (
        <FormErrorMessage>{error}</FormErrorMessage>
      ) : (
        helperText && <FormHelperText>{helperText}</FormHelperText>
      )}
    </FormControl>
  );
}
