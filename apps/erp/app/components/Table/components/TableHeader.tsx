import { Hidden, Input, Submit, ValidatedForm } from "@carbon/form";
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
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type {
  Column,
  ColumnOrderState,
  ColumnPinningState,
} from "@tanstack/react-table";
import { useEffect, useState, type ReactNode } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LuCheck, LuFilePen, LuImport, LuLayers, LuLock } from "react-icons/lu";
import { SearchFilter } from "~/components";
import { ImportCSVModal } from "~/components/ImportCSVModal";
import { CollapsibleSidebarTrigger } from "~/components/Layout/Navigation";
import { useUrlParams } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { fieldMappings } from "~/modules/shared/imports.models";
import { savedViewValidator } from "~/modules/shared/shared.models";
import type { action as savedViewAction } from "~/routes/x+/shared+/views";
import { path } from "~/utils/path";
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
  columnPinning: ColumnPinningState;
  columnVisibility: Record<string, boolean>;
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
  table?: string;
  title?: string;
  withSavedView: boolean;
  withInlineEditing: boolean;
  withPagination: boolean;
  withSearch: boolean;
  withSelectableRows: boolean;
};

const TableHeader = <T extends object>({
  compact,
  columnAccessors,
  columnOrder,
  columnPinning,
  columnVisibility,
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
  table,
  title,
  withInlineEditing,
  withPagination,
  withSavedView,
  withSearch,
  withSelectableRows,
}: HeaderProps<T>) => {
  const [params, setParams] = useUrlParams();
  const currentFilters = params.getAll("filter").filter(Boolean);
  const currentSorts = params.getAll("sort").filter(Boolean);

  const [importCSVTable, setImportCSVTable] = useState<
    keyof typeof fieldMappings | null
  >(null);

  const savedViewDisclosure = useDisclosure();
  const canSaveView = withSavedView && !!table;

  const fetcher = useFetcher<typeof savedViewAction>();

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.id) {
      setParams({ view: fetcher.data.id });
      savedViewDisclosure.onClose();
    } else if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data?.success]);

  const { currentView, hasView } = useSavedViews();
  const viewTitle = currentView?.name ?? title;
  // const viewDescription = currentView?.description ?? "";

  const hideTitleBar = !viewTitle && !primaryAction && !canSaveView;

  return (
    <div className={cn("w-full flex flex-col", !compact && "mb-8")}>
      {canSaveView && savedViewDisclosure.isOpen ? (
        <ValidatedForm
          method="post"
          action={path.to.saveViews}
          validator={savedViewValidator}
          resetAfterSubmit
          className="w-full px-2 md:px-0"
          defaultValues={currentView ?? {}}
          fetcher={fetcher}
        >
          <Card className="my-4 p-0">
            <Hidden name="id" value={currentView?.id} />
            <Hidden
              name="state"
              value={JSON.stringify({
                columnOrder,
                columnPinning,
                columnVisibility,
                filters: currentFilters,
                sorts: currentSorts,
              })}
            />
            <Hidden name="table" value={table} />
            <Hidden name="type" value="Private" />
            <CardContent className="flex flex-col gap-0 p-4">
              <Input
                autoFocus
                name="name"
                placeholder="My Saved View"
                label=""
                className="font-medium text-base"
                borderless
              />
              <Input
                name="description"
                label=""
                placeholder="Description (optional)"
                className="text-sm"
                borderless
              />
            </CardContent>
            <CardFooter className="border-t bg-muted/30 p-4">
              <Button variant="secondary" onClick={savedViewDisclosure.onClose}>
                Cancel
              </Button>
              <Submit>{hasView ? "Update" : "Save"}</Submit>
            </CardFooter>
          </Card>
        </ValidatedForm>
      ) : (
        !hideTitleBar && (
          <HStack
            className={cn(
              compact
                ? "px-4 py-2 justify-between bg-card border-b  w-full"
                : "px-4 md:px-0 py-6 justify-between bg-card w-full relative"
            )}
          >
            <HStack spacing={1}>
              <CollapsibleSidebarTrigger />
              {viewTitle && (
                <Heading size={compact ? "h3" : "h2"}>{viewTitle}</Heading>
              )}
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
        )
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

          {canSaveView && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label="Save View"
                  variant={
                    savedViewDisclosure.isOpen || hasView ? "active" : "ghost"
                  }
                  icon={<LuLayers />}
                  onClick={savedViewDisclosure.onToggle}
                />
              </TooltipTrigger>
              <TooltipContent>
                <p>{hasView ? "Edit View" : "Save View"}</p>
              </TooltipContent>
            </Tooltip>
          )}

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
