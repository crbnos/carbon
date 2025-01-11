import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
} from "@carbon/react";
import type { Column, ColumnOrderState } from "@tanstack/react-table";
import { useState, type ReactNode } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuFilePen, LuImport, LuLock, LuZap } from "react-icons/lu";
import { SearchFilter } from "~/components";
import { ImportCSVModal } from "~/components/ImportCSVModal";
import { CollapsibleSidebarTrigger } from "~/components/Layout/Navigation";
import { useUrlParams } from "~/hooks";
import type { fieldMappings } from "~/modules/shared/imports.models";
import Columns from "./Columns";
import { ActiveFilters, Filter } from "./Filter";
import type { ColumnFilter } from "./Filter/types";
import type { PaginationProps } from "./Pagination";
import { PaginationButtons } from "./Pagination";
import Sort from "./Sort";

type HeaderProps<T> = {
  renderActions?: (selectedRows: T[]) => ReactNode;
  columnAccessors: Record<string, string>;
  columnOrder: ColumnOrderState;
  columns: Column<T, unknown>[];
  compact?: boolean;
  editMode: boolean;
  filters: ColumnFilter[];
  importCSV?: {
    table: keyof typeof fieldMappings;
    label: string;
  }[];
  primaryAction?: ReactNode;
  pagination: PaginationProps;
  selectedRows: T[];
  setColumnOrder: (newOrder: ColumnOrderState) => void;
  setEditMode: (editMode: boolean) => void;
  title?: string;
  withInlineEditing: boolean;
  withPagination: boolean;
  withSearch: boolean;
  withSelectableRows: boolean;
};

const TableHeader = <T extends object>({
  compact,
  columnAccessors,
  columnOrder,
  columns,
  editMode,
  filters,
  importCSV,
  primaryAction,
  pagination,
  selectedRows,
  renderActions,
  setColumnOrder,
  setEditMode,
  title,
  withInlineEditing,
  withPagination,
  withSearch,
  withSelectableRows,
}: HeaderProps<T>) => {
  const [params] = useUrlParams();
  const currentFilters = params.getAll("filter").filter(Boolean);
  const [importCSVTable, setImportCSVTable] = useState<
    keyof typeof fieldMappings | null
  >(null);

  return (
    <div className={cn("w-full flex flex-col", !compact && "mb-8")}>
      <HStack
        className={cn(
          compact
            ? "px-4 py-2 justify-between bg-card border-b  w-full"
            : "px-4 md:px-0 py-6 md:py-[3.25rem] justify-between bg-card w-full relative"
        )}
      >
        <HStack spacing={1}>
          <CollapsibleSidebarTrigger />
          {title && <Heading size={compact ? "h3" : "h2"}>{title}</Heading>}
        </HStack>

        <HStack>
          {/* <Button variant="secondary" leftIcon={<LuDownload />}>
            Export
          </Button> */}
          <>{primaryAction}</>
          {importCSV && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="Table actions"
                  variant="secondary"
                  icon={<BsThreeDotsVertical />}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Bulk Import</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {importCSV.map(({ table, label }) => (
                  <DropdownMenuItem
                    key={table}
                    onClick={() => {
                      setImportCSVTable(table);
                    }}
                  >
                    <DropdownMenuIcon icon={<LuImport />} />
                    Import {label} CSV
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </HStack>
      </HStack>
      <HStack
        className={cn(
          compact
            ? "px-4 py-2 justify-between bg-card border-b border-border w-full"
            : "px-4 md:px-0 justify-between bg-card w-full"
        )}
      >
        <HStack>{!!filters?.length && <Filter filters={filters} />}</HStack>
        <HStack>
          {withSearch && (
            <SearchFilter param="search" size="sm" placeholder="Search" />
          )}
          {withSelectableRows &&
            selectedRows.length > 0 &&
            typeof renderActions === "function" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="pl-2 pr-1"
                    leftIcon={<LuZap />}
                    variant="secondary"
                  >
                    <Badge variant="secondary">
                      <span>{selectedRows.length}</span>
                    </Badge>
                  </Button>
                </DropdownMenuTrigger>
                {renderActions(selectedRows)}
              </DropdownMenu>
            )}
          <Sort columnAccessors={columnAccessors} />

          <Columns
            columnOrder={columnOrder}
            columns={columns}
            setColumnOrder={setColumnOrder}
            withSelectableRows={withSelectableRows}
          />

          {withPagination &&
            (pagination.canNextPage || pagination.canPreviousPage) && (
              <PaginationButtons {...pagination} condensed />
            )}

          {withInlineEditing &&
            (editMode ? (
              <Button
                leftIcon={<LuLock />}
                variant="secondary"
                onClick={() => setEditMode(false)}
              >
                Lock
              </Button>
            ) : (
              <Button
                leftIcon={<LuFilePen />}
                variant="secondary"
                onClick={() => setEditMode(true)}
              >
                Edit
              </Button>
            ))}
        </HStack>
      </HStack>
      {currentFilters.length > 0 && (
        <HStack
          className={cn(
            compact
              ? "px-4 py-1.5 justify-between bg-card border-b border-border w-full"
              : "px-4 md:px-0 py-1.5 justify-between bg-card w-full"
          )}
        >
          <ActiveFilters filters={filters} />
        </HStack>
      )}
      {importCSVTable && (
        <ImportCSVModal
          table={importCSVTable}
          onClose={() => setImportCSVTable(null)}
        />
      )}
    </div>
  );
};

export default TableHeader;
