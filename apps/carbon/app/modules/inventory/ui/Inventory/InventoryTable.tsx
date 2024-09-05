import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  HStack,
  Heading,
  VStack,
  cn,
} from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useEffect, useMemo, useState } from "react";
import { RxCheck } from "react-icons/rx";
import { Hyperlink, Table } from "~/components";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { usePermissions, useUrlParams } from "~/hooks";
import { usePeople } from "~/stores";
import { itemTypes } from "../../inventory.models";
import type { InventoryItem } from "../../types";
import InventoryItemIcon from "./InventoryItemIcon";
import { useInventoryItem } from "./useInventoryItem";

type InventoryTableProps = {
  data: InventoryItem[];
  count: number;
};

const InventoryTable = memo(({ data, count }: InventoryTableProps) => {
  const permissions = usePermissions();
  const [params] = useUrlParams();
  const filter = params.get("q");
  const search = params.get("search");
  // put rows in state for use with optimistic ui updates
  const [rows, setRows] = useState<InventoryItem[]>(data);
  // we have to do this useEffect silliness since we're putitng rows
  // in state for optimistic ui updates
  useEffect(() => {
    setRows(data);
  }, [data]);

  const { view } = useInventoryItem();

  const { hasFilters } = useFilters();

  const [people] = usePeople();

  const columns = useMemo<ColumnDef<InventoryItem>[]>(() => {
    return [
      {
        accessorKey: "readableId",
        header: "Item ID",
        cell: ({ row }) => (
          <Hyperlink
            onClick={() => view(row.original)}
            className="max-w-[260px] truncate"
          >
            <>{row.original.readableId}</>
          </Hyperlink>
        ),
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => row.original.type,
        meta: {
          filter: {
            type: "static",
            options: itemTypes.map((type) => ({
              label: (
                <HStack spacing={2}>
                  <InventoryItemIcon type={type} />
                  <span>{type}</span>
                </HStack>
              ),
              value: type,
            })),
          },
        },
      },
      {
        accessorKey: "name",
        header: "Name",
        cell: (inventoryItem) => inventoryItem.getValue(),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: (inventoryItem) => inventoryItem.getValue(),
      },
    ];
    // Don't put the revalidator in the deps array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, view]);

  const actions = useMemo(() => {
    return [];
  }, []);

  const defaultColumnVisibility = {
    readableId: true,
    type: true,
    name: true,
    description: true,
  };

  return (
    <>
      {count === 0 && !hasFilters && !search ? (
        <HStack className="w-full h-screen flex items-start justify-center">
          <VStack className="border rounded-md shadow-md w-96 mt-20">
            <div className="w-full flex flex-col gap-4 items-center justify-center py-8 bg-gradient-to-bl from-card to-background rounded-lg text-center group ring-4 ring-transparent hover:ring-white/10">
              <Heading size="h2">No Items Yet</Heading>
              <p className="text-muted-foreground text-base font-light">
                Start by creating your first item
              </p>
            </div>
          </VStack>
        </HStack>
      ) : (
        <Table<InventoryItem>
          actions={actions}
          count={count}
          columns={columns}
          data={rows}
          defaultColumnVisibility={defaultColumnVisibility}
        />
      )}
    </>
  );
});

type CreatableCommandProps = {
  options: {
    label: string;
    value: string;
  }[];
  selected: string[];
  onChange: (selected: string) => void;
  onCreateOption: (inputValue: string) => void;
};

const CreatableCommand = ({
  options,
  selected,
  onChange,
  onCreateOption,
}: CreatableCommandProps) => {
  const [search, setSearch] = useState("");
  const isExactMatch = options.some(
    (option) => option.value.toLowerCase() === search.toLowerCase()
  );

  return (
    <Command>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search..."
        className="h-9"
      />
      <CommandGroup>
        {options.map((option) => {
          const isSelected = !!selected?.includes(option.value);
          return (
            <CommandItem
              value={option.label}
              key={option.value}
              onSelect={() => {
                if (!isSelected) onChange(option.value);
              }}
            >
              {option.label}
              <RxCheck
                className={cn(
                  "ml-auto h-4 w-4",
                  isSelected ? "opacity-100" : "opacity-0"
                )}
              />
            </CommandItem>
          );
        })}
        {!isExactMatch && !!search && (
          <CommandItem
            onSelect={() => {
              onCreateOption(search);
            }}
            value={search}
          >
            <span>Create</span>
            <span className="ml-1 font-bold">{search}</span>
          </CommandItem>
        )}
      </CommandGroup>
    </Command>
  );
};

InventoryTable.displayName = "InventoryTable";

export default InventoryTable;
