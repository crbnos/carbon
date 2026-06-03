import {
  cn,
  Input,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import type { FieldDef, Operator } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuChevronUp,
  LuMapPin,
  LuX
} from "react-icons/lu";
import { useLocations } from "~/components/Form/Location";
import {
  type StorageUnitTreeRow,
  useStorageUnitsTree
} from "~/components/Form/StorageUnitDrillSelect";
import MultiValueCombobox from "./MultiValueCombobox";
import type { ValueOption } from "./useValueOptions";
import ValueCombobox from "./ValueCombobox";

type ValueInputProps = {
  fieldDef: FieldDef | undefined;
  op: Operator;
  value: unknown;
  onChange: (next: unknown) => void;
  options: ValueOption[] | undefined;
};

const isMultiOp = (op: Operator) => op === "in" || op === "notIn";
const isPresenceOp = (op: Operator) => op === "isSet" || op === "isNotSet";

function ValueInputImpl({
  fieldDef,
  op,
  value,
  onChange,
  options
}: ValueInputProps) {
  const { t } = useLingui();

  // Presence ops — no value control. Render dashed placeholder pill so the
  // grid column stays the same width (matches existing visual treatment).
  // Height matches CommandTrigger size="md" (h-10) so the row stays aligned.
  if (isPresenceOp(op)) {
    return (
      <div className="flex h-10 items-center rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground">
        {t`No value needed`}
      </div>
    );
  }

  // Render the autocomplete combobox whenever the field declares a loader,
  // even if `options` is currently empty. The fetcher hooks populate
  // asynchronously on mount; an empty array still renders a usable Combobox
  // (showing the "no values" empty state) which then re-renders with options
  // when the fetch resolves. Falling through to a text input on empty was the
  // bug — the input got "stuck" until the user re-selected the field.
  const hasOptions = !!fieldDef?.valueOptionsLoader && !!options;
  const multi = isMultiOp(op);

  // Multi-select with a known options loader — supplies a real string[] array
  // straight to the AST (no comma-split parsing needed).
  if (multi && hasOptions) {
    const arrValue = Array.isArray(value)
      ? value.map(String).filter(Boolean)
      : [];
    return (
      <MultiValueCombobox
        value={arrValue}
        onChange={(next) => onChange(next)}
        options={options!}
        placeholder={t`Select values`}
      />
    );
  }

  // Single-select autocomplete — used for any scalar op on a field with a
  // loader. Local component for visual parity with FieldCombobox /
  // OperatorCombobox (chevron trigger, same height, full-width).
  if (!multi && hasOptions) {
    const strValue =
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : "";
    return (
      <ValueCombobox
        value={strValue}
        onChange={(next) => onChange(next)}
        options={options!}
        placeholder={t`Select value`}
      />
    );
  }

  // Storage-unit drill picker — hierarchical Location → drilldown selector
  // for scalar ops. Multi ops fall through to the text path (paste UUIDs).
  if (!multi && fieldDef?.type === "storageUnit") {
    const strValue =
      typeof value === "string" && value !== "" ? value : undefined;
    return <StorageUnitValuePicker value={strValue} onChange={onChange} />;
  }

  // Numeric input — only valid on scalar ops; multi on a numeric field falls
  // through to the comma-separated text path below.
  if (!multi && fieldDef?.type === "number") {
    const numValue =
      typeof value === "number"
        ? value
        : typeof value === "string" && value !== ""
          ? Number(value)
          : Number.NaN;
    return (
      <NumberField
        value={Number.isNaN(numValue) ? undefined : numValue}
        onChange={(n) =>
          onChange(typeof n === "number" && !Number.isNaN(n) ? n : undefined)
        }
        aria-label={t`Number`}
      >
        <NumberInputGroup className="relative">
          <NumberInput placeholder={t`Number`} />
          <NumberInputStepper>
            <NumberIncrementStepper>
              <LuChevronUp size="1em" strokeWidth="3" />
            </NumberIncrementStepper>
            <NumberDecrementStepper>
              <LuChevronDown size="1em" strokeWidth="3" />
            </NumberDecrementStepper>
          </NumberInputStepper>
        </NumberInputGroup>
      </NumberField>
    );
  }

  // Fallback — string input. Multi-value without a loader stays as
  // comma-separated text so users can still type literal sets (e.g. on custom
  // fields where no option list is known).
  const display =
    value == null
      ? ""
      : Array.isArray(value)
        ? value.join(", ")
        : String(value);

  return (
    <Input
      size="md"
      type="text"
      placeholder={multi ? t`comma-separated values` : t`Value`}
      value={display}
      onChange={(e) => {
        const raw = e.target.value;
        if (multi) {
          onChange(
            raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          );
        } else {
          onChange(raw);
        }
      }}
    />
  );
}

export default memo(ValueInputImpl);

// ---------------------------------------------------------------------------
// StorageUnitValuePicker — single trigger, popover with location switch +
// drill-down storage-unit tree.
// ---------------------------------------------------------------------------
//
// Custom rules aren't scoped to a location, so location is selectable
// inside the picker's popover (not a sibling input). Trigger shows only the
// unit name (location is implied by the selection); breadcrumb + search live
// inside the popover.
//
// Subcomponents are co-located rather than exposed as compound API — the
// picker is only used in one place. State stays in the parent
// `StorageUnitValuePicker`, passed down explicitly (no internal context
// needed for this scope).

type LocationOption = { value: string; label: React.ReactNode };

function StorageUnitValuePickerImpl({
  value,
  onChange
}: {
  value: string | undefined;
  onChange: (next: unknown) => void;
}) {
  const locations = useLocations() as LocationOption[];

  const [locationId, setLocationId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  // Default to first available location.
  useEffect(() => {
    if (locationId) return;
    if (!locations.length) return;
    setLocationId(locations[0]!.value);
  }, [locationId, locations]);

  // Auto-route to the location whose tree contains `value`. Hops through
  // locations one at a time; bails as soon as it finds a match.
  const tree = useStorageUnitsTree(locationId);
  useEffect(() => {
    if (!value || !locationId) return;
    if (tree.some((r) => r.id === value)) return;
    for (const loc of locations) {
      if (loc.value === locationId) continue;
      setLocationId(loc.value);
      return;
    }
  }, [value, locationId, tree, locations]);

  const byId = useMemo(() => {
    const m = new Map<string, StorageUnitTreeRow>();
    for (const r of tree) m.set(r.id, r);
    return m;
  }, [tree]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, StorageUnitTreeRow[]>();
    for (const r of tree) {
      const arr = m.get(r.parentId) ?? [];
      arr.push(r);
      m.set(r.parentId, arr);
    }
    for (const arr of m.values())
      arr.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [tree]);

  const currentParentId = stack.length === 0 ? null : stack[stack.length - 1]!;
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
    return tree.filter((r) => {
      if (r.name?.toLowerCase().includes(q)) return true;
      return (r.ancestorPath ?? []).some((id) =>
        byId.get(id)?.name?.toLowerCase().includes(q)
      );
    });
  }, [search, tree, byId]);

  const selectedRow = value ? byId.get(value) : undefined;
  const selectedLocation = locations.find((l) => l.value === locationId);
  const selectedLocationLabel = selectedLocation
    ? typeof selectedLocation.label === "string"
      ? selectedLocation.label
      : ""
    : "";

  const reset = () => {
    setStack([]);
    setSearch("");
  };

  // On open with an existing value: stack to the selected row's parent so
  // user lands viewing the selected unit highlighted in its sibling list.
  useEffect(() => {
    if (!open) return;
    if (!value) return;
    const row = byId.get(value);
    if (!row) return;
    setStack((row.ancestorPath ?? []).slice(0, -1));
  }, [open, value, byId]);

  const select = (id: string) => {
    onChange(id || undefined);
    setOpen(false);
    reset();
  };

  const [locOpen, setLocOpen] = useState(false);

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
          className={cn(
            "group flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm text-left",
            "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color,box-shadow]",
            !selectedRow && "text-muted-foreground"
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {selectedRow?.name ?? "Select storage unit"}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {value ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(undefined);
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
        align="end"
        sideOffset={4}
        collisionPadding={12}
        avoidCollisions
        className="w-auto min-w-[220px] max-w-[min(420px,calc(100vw-24px))] p-0"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Breadcrumb — always visible. Root crumb is the location, clickable
            to switch locations via a nested popover. */}
        <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5">
          <Popover open={locOpen} onOpenChange={setLocOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-muted",
                  stack.length === 0
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <LuMapPin className="h-3 w-3 opacity-70" />
                {selectedLocationLabel || "Location"}
                <LuChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={4}
              collisionPadding={12}
              className="w-auto min-w-[200px] max-w-[320px] p-1"
            >
              <ul className="max-h-[200px] overflow-y-auto">
                {locations.length === 0 && (
                  <li className="px-2 py-1.5 text-xs text-muted-foreground">
                    Loading…
                  </li>
                )}
                {locations.map((l) => {
                  const isActive = l.value === locationId;
                  return (
                    <li key={l.value}>
                      <button
                        type="button"
                        onClick={() => {
                          setLocationId(l.value);
                          setStack([]);
                          setSearch("");
                          setLocOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                          isActive && "font-medium text-foreground"
                        )}
                      >
                        <span className="truncate">{String(l.label)}</span>
                        {isActive && (
                          <span className="text-xs text-muted-foreground">
                            ✓
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </PopoverContent>
          </Popover>
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

        {/* Search — flush, no chrome. */}
        <Input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search storage units…"
          className="h-9 rounded-none border-none border-b border-border bg-transparent px-3 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
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

const StorageUnitValuePicker = memo(StorageUnitValuePickerImpl);
