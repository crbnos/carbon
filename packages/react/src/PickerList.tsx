// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CommandEmpty as CommandPrimitiveEmpty } from "cmdk";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { FaRegSquare, FaSquareCheck } from "react-icons/fa6";
import { LuCheck, LuCirclePlus } from "react-icons/lu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem
} from "./Command";
import { TruncatedTooltipText } from "./TruncatedTooltipText";
import { cn } from "./utils/cn";
import { reactNodeToString } from "./utils/react";
import { useViewport } from "./Viewport";

export type PickerListOption = {
  label: string | JSX.Element;
  value: string;
  helper?: string;
  helperRight?: string;
  /** Extra search text, matched but never rendered. */
  keywords?: string;
};

export type PickerListFilter = (
  options: PickerListOption[],
  search: string
) => PickerListOption[];

export type PickerListSelectContext = {
  search: string;
  setSearch: (search: string) => void;
  /** The synthetic "Create …" row of a creatable picker. */
  isCreateOption: boolean;
};

export type PickerListProps = {
  options: PickerListOption[];
  /** The picker's own matching; each picker keeps its own rules. */
  filter: PickerListFilter;
  itemHeight: number;
  /** "single" ends a row with ✓; "multiple" starts it with a checkbox. */
  selectionMode: "single" | "multiple";
  /** The cmdk item value of a row (each picker escapes it differently). */
  getItemValue: (option: PickerListOption) => string | undefined;
  /** Whether the row shows as chosen (✓ or a checked box). */
  isChecked: (
    option: PickerListOption,
    itemValue: string | undefined
  ) => boolean;
  /** Single mode: pads the helper column of the row (`pr-2`). */
  isHelperPadded?: (
    option: PickerListOption,
    itemValue: string | undefined
  ) => boolean;
  /** Single mode: the picker's current value. On phones it always gets the ✓. */
  value?: string;
  onSelect: (
    option: PickerListOption,
    context: PickerListSelectContext
  ) => void;
  /** Controlled search. Leave both unset to keep the search inside the list. */
  search?: string;
  onSearchChange?: (search: string) => void;
  emptyMessage?: ReactNode;
  /** Appends a "Create …" row unless the search exactly matches an option. */
  creatable?: boolean;
  /** Names the thing created while the search is empty. */
  createLabel?: string;
  showCreateOptionOnEmpty?: boolean;
};

const COMPACT_ITEM_HEIGHT = 44;

const labelOf = (option: PickerListOption) =>
  typeof option.label === "string"
    ? option.label
    : reactNodeToString(option.label);

/**
 * The searchable, virtualized option list shared by Combobox,
 * CreatableCombobox, MultiSelect and CreatableMultiSelect.
 *
 * Desktop markup is kept exactly as each picker rendered it before the
 * extraction: the small structural differences between creatable and plain
 * pickers (empty-state placement, group nesting, row classes) follow
 * `creatable` and `selectionMode`. On phones rows are 44px, the list grows
 * to the sheet height and text is plain (no hover tooltips).
 */
function PickerList({
  options,
  filter,
  itemHeight: itemHeightProp,
  selectionMode,
  getItemValue,
  isChecked,
  isHelperPadded,
  value,
  onSelect,
  search: searchProp,
  onSearchChange,
  emptyMessage,
  creatable = false,
  createLabel,
  showCreateOptionOnEmpty = false
}: PickerListProps) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const itemHeight = isPhone ? COMPACT_ITEM_HEIGHT : itemHeightProp;
  const [ownSearch, setOwnSearch] = useState("");
  const search = searchProp ?? ownSearch;
  const setSearch = onSearchChange ?? setOwnSearch;
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo<PickerListOption[]>(() => {
    const filtered = filter(options, search);
    if (!creatable) return filtered;

    const isExactMatch = options.some((option) =>
      [labelOf(option).toLowerCase(), option.helper?.toLowerCase()].includes(
        search.toLowerCase()
      )
    );

    if (isExactMatch || (search.trim() === "" && !showCreateOptionOnEmpty)) {
      return filtered;
    }

    return [
      ...filtered,
      {
        label: t`New`,
        value: "create"
      }
    ];
  }, [options, search, filter, creatable, showCreateOptionOnEmpty, t]);

  const virtualizer = useVirtualizer({
    count: filteredOptions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 12
  });

  const items = virtualizer.getVirtualItems();

  const isCreatableSingle = creatable && selectionMode === "single";
  const scrollerClassName = cn(
    isCreatableSingle
      ? "overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
      : "overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent pt-1",
    "max-md:max-h-[calc(88dvh-120px)]"
  );
  const scrollerStyle = {
    height: `${
      (isPhone ? filteredOptions.length : Math.min(filteredOptions.length, 6)) *
        itemHeight +
      4
    }px`
  };
  const groupStyle = {
    height: `${virtualizer.getTotalSize()}px`,
    width: "100%",
    position: "relative" as const
  };

  const createText = t`Create ${search.trim() === "" ? createLabel : search}`;

  const rows = items.map((virtualRow) => {
    const item = filteredOptions[virtualRow.index]!;
    const itemValue = getItemValue(item);
    const isCreateOption = creatable && item.value === "create";
    const itemHoverText = [labelOf(item), item.helper]
      .filter(Boolean)
      .join(" - ");
    const checked =
      isChecked(item, itemValue) ||
      (isPhone &&
        selectionMode === "single" &&
        value !== undefined &&
        item.value === value);

    return (
      <CommandItem
        key={item.value}
        value={itemValue}
        onSelect={() => {
          onSelect(item, { search, setSearch, isCreateOption });
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: `${itemHeight}px`,
          transform: `translateY(${virtualRow.start}px)`
        }}
        className={
          isCreatableSingle
            ? "flex items-center justify-between min-w-0"
            : undefined
        }
      >
        {selectionMode === "single" ? (
          <>
            {isCreateOption ? (
              <div className="flex items-center min-w-0 flex-1">
                <span>{createText}</span>
              </div>
            ) : item.helper ? (
              <div
                className={cn(
                  "flex flex-col min-w-0 flex-1",
                  isHelperPadded?.(item, itemValue) && "pr-2"
                )}
              >
                <TruncatedTooltipText
                  className="block w-full truncate"
                  tooltip={itemHoverText}
                  enabled={!isPhone}
                >
                  {item.label}
                </TruncatedTooltipText>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <TruncatedTooltipText
                    className="truncate flex-1"
                    tooltip={itemHoverText}
                    enabled={!isPhone}
                  >
                    {item.helper}
                  </TruncatedTooltipText>
                  {item.helperRight && (
                    <span className="flex-shrink-0">{item.helperRight}</span>
                  )}
                </div>
              </div>
            ) : (
              <TruncatedTooltipText
                className="truncate flex-1"
                tooltip={itemHoverText}
                enabled={!isPhone}
              >
                {item.label}
              </TruncatedTooltipText>
            )}
            {!isCreateOption && (
              <LuCheck
                className={cn(
                  "ml-auto h-4 w-4",
                  creatable && "flex-shrink-0",
                  checked ? "opacity-100" : "opacity-0 hidden"
                )}
              />
            )}
          </>
        ) : creatable ? (
          <div className="flex justify-start items-center gap-1 px-2 min-w-0 flex-1">
            {isCreateOption ? (
              <>
                <LuCirclePlus className="mr-1.5 flex-shrink-0" />
                <span>{createText}</span>
              </>
            ) : (
              <>
                {checked ? (
                  <FaSquareCheck className="mr-1.5 text-primary flex-shrink-0" />
                ) : (
                  <FaRegSquare className="mr-1.5 text-muted-foreground flex-shrink-0" />
                )}
                {item.helper ? (
                  <div className="flex flex-col min-w-0 flex-1">
                    <TruncatedTooltipText
                      className="block w-full truncate"
                      tooltip={itemHoverText}
                      enabled={!isPhone}
                    >
                      {item.label}
                    </TruncatedTooltipText>
                    <TruncatedTooltipText
                      className="text-xs text-muted-foreground truncate"
                      tooltip={itemHoverText}
                      enabled={!isPhone}
                    >
                      {item.helper}
                    </TruncatedTooltipText>
                  </div>
                ) : (
                  <TruncatedTooltipText
                    className="truncate flex-1"
                    tooltip={itemHoverText}
                    enabled={!isPhone}
                  >
                    {item.label}
                  </TruncatedTooltipText>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-start gap-2">
            {checked ? (
              <FaSquareCheck className="mr-1.5 text-primary shrink-0" />
            ) : (
              <FaRegSquare className="mr-1.5 text-muted-foreground shrink-0" />
            )}
            {item.helper ? (
              <div className="flex flex-col min-w-0">
                <p className="line-clamp-1">{item.label}</p>
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {item.helper}
                </p>
              </div>
            ) : (
              <span className="line-clamp-1 min-w-0">{item.label}</span>
            )}
          </div>
        )}
      </CommandItem>
    );
  });

  // Creatable multi-select puts its (unstyled) empty state inside the scroller;
  // the plain pickers put the styled one above it.
  const emptyInsideScroller = creatable && selectionMode === "multiple";

  return (
    <Command shouldFilter={false}>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={t`Search...`}
        className="h-9 max-md:h-11 max-md:text-base"
      />
      {isCreatableSingle ? (
        <CommandGroup>
          <div
            ref={parentRef}
            className={scrollerClassName}
            style={scrollerStyle}
          >
            <div style={groupStyle}>{rows}</div>
          </div>
        </CommandGroup>
      ) : (
        <>
          {emptyMessage !== undefined && !emptyInsideScroller && (
            <CommandEmpty>{emptyMessage}</CommandEmpty>
          )}
          <div
            ref={parentRef}
            className={scrollerClassName}
            style={scrollerStyle}
          >
            {emptyMessage !== undefined && emptyInsideScroller && (
              <CommandPrimitiveEmpty>{emptyMessage}</CommandPrimitiveEmpty>
            )}
            <CommandGroup style={groupStyle}>{rows}</CommandGroup>
          </div>
        </>
      )}
    </Command>
  );
}

export { PickerList };
