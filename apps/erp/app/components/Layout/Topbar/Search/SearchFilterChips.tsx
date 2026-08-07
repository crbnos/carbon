import { cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import {
  entityTypeConfig,
  getEntityTypeConfig,
  getEntityTypeLabel
} from "~/components/Layout/Topbar/Search/config";
import type {
  EntityTypeFilter,
  SearchFilterChipsProps
} from "~/components/Layout/Topbar/Search/types";

/** Entity types exposed as filter chips (keys are constrained to EntityType). */
const FILTERABLE_ENTITY_TYPES = Object.keys(entityTypeConfig) as Array<
  keyof typeof entityTypeConfig
>;

const FILTER_OPTIONS: { value: EntityTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...FILTERABLE_ENTITY_TYPES.map((value) => ({
    value,
    label: getEntityTypeLabel(value)
  }))
];

export function SearchFilterChips({
  selectedFilter,
  onFilterChange
}: SearchFilterChipsProps) {
  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 border-b border-border scrollbar-none"
      role="toolbar"
      aria-label="Filter search by type"
    >
      {FILTER_OPTIONS.map((option) => {
        const isSelected = selectedFilter === option.value;
        const config =
          option.value === "all" ? null : getEntityTypeConfig(option.value);
        const Icon = config?.icon;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onFilterChange(option.value)}
            aria-pressed={isSelected}
            className={cn(
              "inline-flex items-center gap-1.5 flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? option.value === "all"
                  ? "bg-foreground text-background border-foreground"
                  : cn(
                      config?.bgColor,
                      config?.textColor,
                      "border-transparent ring-1 ring-inset ring-black/5 dark:ring-white/10"
                    )
                : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
            )}
          >
            {Icon ? <Icon className="w-3 h-3" /> : null}
            {option.value === "all" ? <Trans>All</Trans> : option.label}
          </button>
        );
      })}
    </div>
  );
}
