import { Button, HStack } from "@carbon/react";
import type { Column, ColumnOrderState } from "@tanstack/react-table";
import { type ReactNode } from "react";
import { BsFillCheckCircleFill } from "react-icons/bs";
import { MdOutlineEditNote } from "react-icons/md";
import { DebouncedInput } from "~/components/Search";
import { useUrlParams } from "~/hooks";
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

  return (
    <>
      <HStack className="px-4 py-2 justify-between bg-card border-b border-border w-full">
        <HStack>
          {withSearch && (
            <DebouncedInput param="search" size="sm" placeholder="Search" />
          )}
          {!!filters?.length && <Filter filters={filters} />}
        </HStack>
        <HStack>
          {withSelectableRows && actions.length > 0 && (
            // TODO: move this to a draggable bar like Linear
            <Actions actions={actions} selectedRows={selectedRows} />
          )}
          {withInlineEditing &&
            (editMode ? (
              <Button
                leftIcon={<BsFillCheckCircleFill />}
                onClick={() => setEditMode(false)}
              >
                Finish Editing
              </Button>
            ) : (
              <Button
                leftIcon={<MdOutlineEditNote />}
                variant="ghost"
                onClick={() => setEditMode(true)}
              >
                Edit
              </Button>
            ))}
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
          <>{primaryAction}</>
        </HStack>
      </HStack>
      {currentFilters.length > 0 && (
        <HStack className="px-4 py-1.5 justify-between bg-card border-b border-border w-full">
          <HStack>
            <ActiveFilters filters={filters} />
          </HStack>
        </HStack>
      )}
    </>
  );
};

export default TableHeader;
