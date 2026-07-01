import {
  Badge,
  BadgeCloseButton,
  Combobox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@carbon/react";
import { useCallback, useMemo, useState } from "react";
import { LuPlus } from "react-icons/lu";
import { useFetcher } from "react-router";
import { DimensionEntityTypeIcon } from "~/components/Icons";
import { useCustomers, useItems, useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import type { DimensionWithValues, JournalLineDimensionValue } from "./types";

/**
 * Entity types with far too many rows to eagerly load into a radio list. Their
 * options are sourced lazily from the client stores (useCustomers / useSuppliers
 * / useItems) and rendered with a searchable, virtualized Combobox instead.
 */
const HIGH_CARDINALITY_ENTITY_TYPES = new Set(["Customer", "Supplier", "Item"]);

type DimensionSelectorProps = {
  journalLineId: string;
  availableDimensions: DimensionWithValues[];
  currentDimensions: JournalLineDimensionValue[];
  onChange: (dimensions: JournalLineDimensionValue[]) => void;
  /** When true, changes are also persisted immediately via fetcher (for posted entries) */
  autoSave?: boolean;
};

const entityTypeColors: Record<string, string> = {
  Department:
    "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400 border-red-500/20",
  Employee:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-400 border-indigo-500/20",
  CustomerType:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-400 border-yellow-500/20",
  Customer:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400 border-amber-500/20",
  SupplierType:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400 border-emerald-500/20",
  Supplier:
    "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-400 border-green-500/20",
  Item: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-400 border-fuchsia-500/20",
  Location:
    "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400 border-blue-500/20",
  CostCenter:
    "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-400 border-orange-500/20",
  ItemPostingGroup:
    "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-400 border-violet-500/20",
  WorkCenter:
    "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-400 border-teal-500/20",
  Process:
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-400 border-cyan-500/20",
  Custom: ""
};

function getColor(entityType: string) {
  return entityTypeColors[entityType] ?? "";
}

const DimensionSelector = ({
  journalLineId,
  availableDimensions,
  currentDimensions,
  onChange,
  autoSave = false
}: DimensionSelectorProps) => {
  const fetcher = useFetcher();

  const [customers] = useCustomers();
  const [suppliers] = useSuppliers();
  const [items] = useItems();

  // High-cardinality dimensions the user has chosen to add from the dropdown
  // but not yet given a value — these render their searchable Combobox inline.
  const [activeHighCardIds, setActiveHighCardIds] = useState<Set<string>>(
    new Set()
  );

  // Lazily-sourced options for the high-cardinality entity types, keyed by
  // entityType. Built from the client stores so we never round-trip thousands
  // of rows through the loader.
  const optionsByEntityType = useMemo(
    () => ({
      Customer: customers.map((c) => ({ value: c.id, label: c.name })),
      Supplier: suppliers.map((s) => ({ value: s.id, label: s.name })),
      Item: items.map((i) => ({
        value: i.id,
        label: i.readableIdWithRevision,
        helper: i.name
      }))
    }),
    [customers, suppliers, items]
  );

  const valueByDimension = new Map(
    currentDimensions.map((d) => [d.dimensionId, d.valueId])
  );

  const persistDimensions = useCallback(
    (dims: JournalLineDimensionValue[]) => {
      if (!autoSave) return;
      fetcher.submit(
        {
          dimensions: dims.map((d) => ({
            dimensionId: d.dimensionId,
            valueId: d.valueId
          }))
        },
        {
          method: "post",
          action: path.to.journalLineDimensions(journalLineId),
          encType: "application/json"
        }
      );
    },
    [autoSave, fetcher, journalLineId]
  );

  function applyDimension(
    dim: DimensionWithValues,
    valueId: string,
    valueName: string
  ) {
    const updated = [
      ...currentDimensions.filter((d) => d.dimensionId !== dim.dimensionId),
      {
        dimensionId: dim.dimensionId,
        dimensionName: dim.dimensionName,
        valueId,
        valueName
      }
    ];
    onChange(updated);
    persistDimensions(updated);
  }

  // Low-cardinality types: value + name both come from the preloaded radio list.
  function handleValueChange(dim: DimensionWithValues, valueId: string) {
    const val = dim.values.find((v) => v.id === valueId);
    if (!val) return;
    applyDimension(dim, val.id, val.name);
  }

  // High-cardinality types: resolve the name from the store-backed option.
  function handleComboboxChange(dim: DimensionWithValues, valueId: string) {
    if (!valueId) {
      handleRemove(dim.dimensionId);
      return;
    }
    const options =
      optionsByEntityType[dim.entityType as keyof typeof optionsByEntityType] ??
      [];
    const option = options.find((o) => o.value === valueId);
    applyDimension(dim, valueId, option?.label ?? valueId);
    // Once a value is chosen it shows as a badge; collapse the inline combobox.
    deactivateHighCard(dim.dimensionId);
  }

  function deactivateHighCard(dimensionId: string) {
    setActiveHighCardIds((prev) => {
      if (!prev.has(dimensionId)) return prev;
      const next = new Set(prev);
      next.delete(dimensionId);
      return next;
    });
  }

  function handleRemove(dimensionId: string) {
    const updated = currentDimensions.filter(
      (d) => d.dimensionId !== dimensionId
    );
    onChange(updated);
    persistDimensions(updated);
    deactivateHighCard(dimensionId);
  }

  const dimensionEntityTypeMap = new Map(
    availableDimensions.map((d) => [d.dimensionId, d.entityType])
  );

  // Low-cardinality dimensions live in the "Dimension +" dropdown. High-
  // cardinality ones are offered in the dropdown too, but selecting one reveals
  // an inline searchable Combobox (sourced from the stores) rather than a list.
  const lowCardinalityDimensions = availableDimensions.filter(
    (d) => !HIGH_CARDINALITY_ENTITY_TYPES.has(d.entityType)
  );
  const selectedDimensionIds = new Set(
    currentDimensions.map((d) => d.dimensionId)
  );
  // High-cardinality dimensions awaiting a value: user-activated and not yet set.
  const pendingHighCardinalityDimensions = availableDimensions.filter(
    (d) =>
      HIGH_CARDINALITY_ENTITY_TYPES.has(d.entityType) &&
      activeHighCardIds.has(d.dimensionId) &&
      !selectedDimensionIds.has(d.dimensionId)
  );
  // High-cardinality dimensions still offerable in the dropdown.
  const addableHighCardinalityDimensions = availableDimensions.filter(
    (d) =>
      HIGH_CARDINALITY_ENTITY_TYPES.has(d.entityType) &&
      !activeHighCardIds.has(d.dimensionId) &&
      !selectedDimensionIds.has(d.dimensionId)
  );
  const showDropdown =
    lowCardinalityDimensions.length > 0 ||
    addableHighCardinalityDimensions.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showDropdown && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Badge
              variant="secondary"
              className="inline-flex items-center cursor-pointer gap-1"
            >
              <span>Dimension</span>
              <LuPlus />
            </Badge>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Dimensions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {addableHighCardinalityDimensions.map((dim) => (
              <DropdownMenuItem
                key={dim.dimensionId}
                onSelect={() =>
                  setActiveHighCardIds((prev) =>
                    new Set(prev).add(dim.dimensionId)
                  )
                }
              >
                <DropdownMenuIcon
                  icon={
                    <DimensionEntityTypeIcon
                      entityType={dim.entityType as any}
                    />
                  }
                />
                {dim.dimensionName}
              </DropdownMenuItem>
            ))}
            {lowCardinalityDimensions.map((dim) =>
              dim.values.length === 0 ? (
                <DropdownMenuLabel
                  key={dim.dimensionId}
                  className="flex items-center gap-2 text-muted-foreground font-normal text-sm flex-nowrap"
                >
                  <DimensionEntityTypeIcon entityType={dim.entityType as any} />
                  {dim.dimensionName}
                </DropdownMenuLabel>
              ) : (
                <DropdownMenuSub key={dim.dimensionId}>
                  <DropdownMenuSubTrigger>
                    <DropdownMenuIcon
                      icon={
                        <DimensionEntityTypeIcon
                          entityType={dim.entityType as any}
                        />
                      }
                    />
                    {dim.dimensionName}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={valueByDimension.get(dim.dimensionId) ?? ""}
                      onValueChange={(valueId) =>
                        handleValueChange(dim, valueId)
                      }
                    >
                      {dim.values.map((val) => (
                        <DropdownMenuRadioItem key={val.id} value={val.id}>
                          {val.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {pendingHighCardinalityDimensions.map((dim) => (
        <Combobox
          key={dim.dimensionId}
          size="sm"
          className="w-44"
          isClearable
          placeholder={dim.dimensionName}
          value=""
          options={
            optionsByEntityType[
              dim.entityType as keyof typeof optionsByEntityType
            ] ?? []
          }
          onChange={(valueId) => handleComboboxChange(dim, valueId)}
        />
      ))}
      {currentDimensions.map((dim) => (
        <Badge
          key={dim.dimensionId}
          role="group"
          tabIndex={0}
          variant="outline"
          className={cn(
            getColor(dimensionEntityTypeMap.get(dim.dimensionId) ?? ""),
            "inline-flex items-center gap-1"
          )}
        >
          <DimensionEntityTypeIcon
            entityType={dimensionEntityTypeMap.get(dim.dimensionId) as any}
            className="size-3"
          />
          <span>{dim.valueName}</span>
          <BadgeCloseButton
            tabIndex={0}
            onClick={() => handleRemove(dim.dimensionId)}
            aria-label={`Remove ${dim.valueName}`}
          />
        </Badge>
      ))}
    </div>
  );
};

export default DimensionSelector;
