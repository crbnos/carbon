// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useContext, useState } from "react";
import {
  LuDownload,
  LuEllipsis,
  LuListChecks,
  LuListFilter,
  LuUpload
} from "react-icons/lu";
import { SearchFilter } from "~/components";
import { ImportCSVModal } from "~/components/ImportCSVModal";
import { AppBarActions } from "~/components/Layout/Mobile/ChromeSlots";
import { createValueSlot } from "~/components/Layout/Mobile/slots";
import { RecordFrameContext } from "~/components/Layout/Panels";
import type { fieldMappings } from "~/modules/shared/imports.models";
import { type DownloadProps, useCsvDownload } from "../Download";
import { ActiveFilters } from "../Filter";
import type { ColumnFilter } from "../Filter/types";
import { useFilters } from "../Filter/useFilters";
import { FilterSortSheet } from "./FilterSortSheet";

const NO_EXPORT: DownloadProps = {
  data: [],
  columnAccessors: {},
  exportValues: {},
  exportOnlyColumns: [],
  columnOrder: [],
  columnVisibility: {}
};

type CompactToolbarProps = {
  title?: string;
  tableName?: string;
  count: number;
  filters: ColumnFilter[];
  sortKeyToLabel: Record<string, string>;
  withSearch: boolean;
  withSort: boolean;
  headerActions?: ReactNode;
  /** The badge desktop shows beside the table title (e.g. a document status). */
  titleBadge?: ReactNode;
  csvExport?: DownloadProps;
  importCSV?: { table: keyof typeof fieldMappings; label: string }[];
  onSelect?: () => void;
  /** Extra items first in the ⋯ (a page's own phone actions). */
  menuItems?: ReactNode;
  hideControls?: boolean;
};

/**
 * The compact list toolbar: search plus a Filter & sort button
 * with a count, the active filter chips in one scrolling row, and an app bar
 * ⋯ for Export CSV, Import and Select. Column and density controls stay on
 * desktop.
 */
/**
 * Phones: a page shown over its list (a `compactFocus` detail pane) takes
 * over the app bar; while it is mounted the hidden list's ⋯ stays out of it.
 */
const listMenuHiddenSlot = createValueSlot<true>();
export const useHideListAppBarMenu = () => listMenuHiddenSlot.useProvide(true);

export function CompactToolbar({
  title,
  tableName,
  count,
  filters,
  sortKeyToLabel,
  withSearch,
  withSort,
  headerActions,
  titleBadge,
  csvExport,
  importCSV,
  onSelect,
  menuItems,
  hideControls = false
}: CompactToolbarProps) {
  const { t } = useLingui();
  const { urlFiltersParams, hasFilters } = useFilters();
  const [sheetOpen, setSheetOpen] = useState(false);
  const exportCsv = useCsvDownload(csvExport ?? NO_EXPORT);
  const [importTable, setImportTable] = useState<
    keyof typeof fieldMappings | null
  >(null);

  const canFilter =
    filters.length > 0 || (withSort && Object.keys(sortKeyToLabel).length > 0);
  const activeCount = urlFiltersParams.filter(Boolean).length;
  const canExport = Boolean(csvExport?.data.length);
  const hasBuiltIns = canExport || Boolean(importCSV?.length || onSelect);
  const hasMenu = hasBuiltIns || Boolean(menuItems);

  // Inside a record frame the app bar ⋯ is the record's: the table's own
  // ⋯ sits in its search row instead, so the bar never shows two.
  const inRecord = useContext(RecordFrameContext);
  const listMenuHidden = listMenuHiddenSlot.useValue() === true;
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          className="order-last"
          aria-label={t`More actions`}
          icon={<LuEllipsis />}
          // Matches the bordered Filter button beside it in the search row.
          variant={inRecord ? "secondary" : "ghost"}
          size="lg"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {menuItems}
        {menuItems && hasBuiltIns ? <DropdownMenuSeparator /> : null}
        {canExport ? (
          <DropdownMenuItem onClick={exportCsv}>
            <DropdownMenuIcon icon={<LuDownload />} />
            <Trans>Export CSV</Trans>
          </DropdownMenuItem>
        ) : null}
        {importCSV?.map(({ table, label }) => (
          <DropdownMenuItem key={table} onClick={() => setImportTable(table)}>
            <DropdownMenuIcon icon={<LuUpload />} />
            {t`Import ${label} CSV`}
          </DropdownMenuItem>
        ))}
        {onSelect ? (
          <DropdownMenuItem onClick={onSelect}>
            <DropdownMenuIcon icon={<LuListChecks />} />
            <Trans>Select</Trans>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      {hasMenu && !inRecord && !listMenuHidden ? (
        <AppBarActions>{menu}</AppBarActions>
      ) : null}

      {titleBadge ? (
        <div className="shrink-0 flex items-center gap-2 bg-card px-4 pt-3">
          {titleBadge}
        </div>
      ) : null}
      {!hideControls && (withSearch || canFilter) ? (
        <div className="shrink-0 flex items-center gap-2 bg-card px-4 pt-3 pb-2">
          {withSearch ? (
            <div className="min-w-0 flex-1">
              <SearchFilter
                param="search"
                size="sm"
                placeholder={title ? t`Search ${title}` : t`Search`}
              />
            </div>
          ) : (
            <div className="flex-1" />
          )}
          {canFilter ? (
            <div className="relative shrink-0">
              <IconButton
                aria-label={t`Filter and sort`}
                icon={<LuListFilter />}
                variant={activeCount > 0 ? "active" : "secondary"}
                size="lg"
                onClick={() => setSheetOpen(true)}
              />
              {activeCount > 0 ? (
                <span className="pointer-events-none absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-medium leading-4 text-primary-foreground tabular-nums">
                  {activeCount}
                </span>
              ) : null}
            </div>
          ) : null}
          {hasMenu && inRecord ? menu : null}
        </div>
      ) : null}

      {!hideControls && hasFilters ? (
        <div className="shrink-0 overflow-x-auto scrollbar-hide scroll-fade-x bg-card px-4 pb-2 [&>div]:flex-nowrap [&>div]:w-max">
          <ActiveFilters filters={filters} />
        </div>
      ) : null}

      {!hideControls && headerActions ? (
        <div className="shrink-0 flex items-center gap-2 overflow-x-auto scrollbar-hide scroll-fade-x bg-card px-4 pt-0.5 pb-2.5 [&:not(:has(button,a,input))]:hidden [&>*]:shrink-0 [&_button]:h-11">
          {headerActions}
        </div>
      ) : null}

      {canFilter ? (
        <FilterSortSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          filters={filters}
          sortKeyToLabel={withSort ? sortKeyToLabel : {}}
          tableName={tableName}
          count={count}
        />
      ) : null}
      {importTable ? (
        <ImportCSVModal
          table={importTable}
          onClose={() => setImportTable(null)}
        />
      ) : null}
    </>
  );
}
