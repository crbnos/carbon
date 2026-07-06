import {
  Badge,
  BadgeCloseButton,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@carbon/react";
import { useCallback } from "react";
import { LuPlus } from "react-icons/lu";
import { useFetcher } from "react-router";
import { DimensionEntityTypeIcon } from "~/components/Icons";
import { path } from "~/utils/path";
import type { DimensionWithValues, JournalLineDimensionValue } from "./types";

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
  SupplierType:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400 border-emerald-500/20",
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

  function handleValueChange(dim: DimensionWithValues, valueId: string) {
    const val = dim.values.find((v) => v.id === valueId);
    if (!val) return;

    const updated = [
      ...currentDimensions.filter((d) => d.dimensionId !== dim.dimensionId),
      {
        dimensionId: dim.dimensionId,
        dimensionName: dim.dimensionName,
        valueId: val.id,
        valueName: val.name
      }
    ];
    onChange(updated);
    persistDimensions(updated);
  }

  function handleRemove(dimensionId: string) {
    const updated = currentDimensions.filter(
      (d) => d.dimensionId !== dimensionId
    );
    onChange(updated);
    persistDimensions(updated);
  }

  const dimensionEntityTypeMap = new Map(
    availableDimensions.map((d) => [d.dimensionId, d.entityType])
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {availableDimensions.length > 0 && (
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
            {availableDimensions.map((dim) =>
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
