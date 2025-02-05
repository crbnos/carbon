import { Input, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
} from "@carbon/react";
import type { Column, ColumnOrderState } from "@tanstack/react-table";
import { useState, type ReactNode } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuCheck, LuFilePen, LuImport, LuLayers, LuLock } from "react-icons/lu";
import { z } from "zod";
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

  const savedViewDisclosure = useDisclosure();

  return (
    <div className={cn("w-full flex flex-col", !compact && "mb-8")}>
      {savedViewDisclosure.isOpen ? (
        <ValidatedForm
          onSubmit={() => {}}
          validator={z.object({
            name: z
              .string()
              .min(1, { message: "A name is required to save a view" }),
          })}
          className="w-full px-2 md:px-0"
        >
          <Card className="my-4 p-0">
            <CardContent className="flex flex-col gap-0 p-4">
              <Input
                autoFocus
                name="name"
                placeholder="My Saved View"
                label=""
                className="border-none p-0 ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-medium text-base"
              />
              <Input
                name="description"
                label=""
                placeholder="Description (optional)"
                className="border-none p-0 ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
              />
            </CardContent>
            <CardFooter className="border-t bg-muted/30 p-4">
              <Button variant="secondary" onClick={savedViewDisclosure.onClose}>
                Cancel
              </Button>
              <Button>Save</Button>
            </CardFooter>
          </Card>
        </ValidatedForm>
      ) : (
        <HStack
          className={cn(
            compact
              ? "px-4 py-2 justify-between bg-card border-b  w-full"
              : "px-4 md:px-0 py-6 justify-between bg-card w-full relative"
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
      )}
      <HStack
        className={cn(
          compact
            ? "px-4 py-2 justify-between bg-card border-b border-border w-full"
            : "px-4 md:px-0 justify-between bg-card w-full"
        )}
      >
        <HStack>
          {withSelectableRows &&
            selectedRows.length > 0 &&
            typeof renderActions === "function" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="pl-2 pr-1"
                    leftIcon={<LuCheck />}
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

          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                aria-label="Save View"
                variant={savedViewDisclosure.isOpen ? "active" : "ghost"}
                icon={<LuLayers />}
                onClick={savedViewDisclosure.onToggle}
              />
            </TooltipTrigger>
            <TooltipContent>
              <p>Save View</p>
            </TooltipContent>
          </Tooltip>

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
