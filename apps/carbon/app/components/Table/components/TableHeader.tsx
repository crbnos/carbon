import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
} from "@carbon/react";
import type { Column, ColumnOrderState } from "@tanstack/react-table";
import { useState, type ReactNode } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuFileEdit, LuImport, LuLock } from "react-icons/lu";
import { SearchFilter } from "~/components";
import { ImportCSVModal } from "~/components/ImportCSVModal";
import { useUrlParams } from "~/hooks";
import type { fieldMappings } from "~/modules/shared/imports.models";
import type { TableAction } from "../types";
import Actions from "./Actions";
import Columns from "./Columns";
import { ActiveFilters, Filter } from "./Filter";
import type { ColumnFilter } from "./Filter/types";
import type { PaginationProps } from "./Pagination";
import { PaginationButtons } from "./Pagination";
import Sort from "./Sort";

type HeaderProps<T> = {
  actions: TableAction<T>[];
  columnAccessors: Record<string, string>;
  columnOrder: ColumnOrderState;
  columns: Column<T, unknown>[];
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
  withInlineEditing: boolean;
  withPagination: boolean;
  withSearch: boolean;
  withSelectableRows: boolean;
};

const TableHeader = <T extends object>({
  actions,
  columnAccessors,
  columnOrder,
  columns,
  editMode,
  filters,
  importCSV,
  primaryAction,
  pagination,
  selectedRows,
  setColumnOrder,
  setEditMode,
  withInlineEditing,
  withPagination,
  withSearch,
  withSelectableRows,
}: HeaderProps<T>) => {
  const [params] = useUrlParams();
  const currentFilters = params.getAll("filter");
  const [importCSVTable, setImportCSVTable] = useState<
    keyof typeof fieldMappings | null
  >(null);

  return (
    <>
      <HStack className="px-4 py-2 justify-between bg-card border-b border-border w-full">
        <HStack>
          {withSearch && (
            <SearchFilter param="search" size="sm" placeholder="Search" />
          )}
          {!!filters?.length && <Filter filters={filters} />}
        </HStack>
        <HStack>
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
          {withSelectableRows && actions.length > 0 && (
            // TODO: move this to a draggable bar like Linear
            <Actions actions={actions} selectedRows={selectedRows} />
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
                leftIcon={<LuFileEdit />}
                variant="secondary"
                onClick={() => setEditMode(true)}
              >
                Edit
              </Button>
            ))}
          <>{primaryAction}</>
          {importCSV && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="Additional actions"
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
      {currentFilters.length > 0 && (
        <HStack className="px-4 py-1.5 justify-between bg-card border-b border-border w-full">
          <HStack>
            <ActiveFilters filters={filters} />
          </HStack>
        </HStack>
      )}
      {importCSVTable && (
        <ImportCSVModal
          table={importCSVTable}
          onClose={() => setImportCSVTable(null)}
        />
      )}
    </>
  );
};

export default TableHeader;
