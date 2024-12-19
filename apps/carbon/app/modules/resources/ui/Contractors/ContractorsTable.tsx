import { Avatar, HStack, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { Hyperlink, New, SupplierAvatar, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Ability, Contractor } from "~/modules/resources";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";

type ContractorsTableProps = {
  data: Contractor[];
  count: number;
  abilities: Partial<Ability>[];
};

const ContractorsTable = memo(
  ({ data, count, abilities }: ContractorsTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [params] = useUrlParams();

    const [suppliers] = useSuppliers();

    const customColumns = useCustomColumns<Contractor>("contractor");
    const columns = useMemo<ColumnDef<Contractor>[]>(() => {
      const defaultColumns: ColumnDef<Contractor>[] = [
        {
          header: "Contractor",
          cell: ({ row }) => (
            <HStack>
              <Avatar
                size="sm"
                name={row.original.fullName ?? row.original.email ?? "Unknown"}
              />
              <Hyperlink
                to={`${path.to.contractor(
                  row.original.supplierContactId!
                )}?${params.toString()}`}
              >
                {row.original.fullName ?? row.original.email ?? "Unknown"}
              </Hyperlink>
            </HStack>
          ),
        },
        {
          id: "supplierId",
          header: "Supplier",
          cell: ({ row }) => (
            <SupplierAvatar supplierId={row.original.supplierId} />
          ),
          meta: {
            filter: {
              type: "static",
              options: suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.name,
              })),
            },
          },
        },

        {
          id: "abilityIds",
          header: "Abilities",
          cell: ({ row }) => {
            if (!row.original.abilityIds) {
              return null;
            } else if (
              row.original.abilityIds &&
              row.original.abilityIds.length === 1
            ) {
              const ability = abilities.find(
                (a) => a.id === row.original.abilityIds![0]
              );
              return <Enumerable value={ability?.name ?? ""} />;
            } else if (
              row.original.abilityIds &&
              row.original.abilityIds.length > 1
            ) {
              return "Multiple Abilities";
            }
          },
          meta: {
            filter: {
              type: "static",
              options: abilities.map((a) => ({
                value: a.id!,
                label: <Enumerable value={a.name!} />,
              })),
              isArray: true,
            },
            pluralHeader: "Abilities",
          },
        },
        {
          accessorKey: "hoursPerWeek",
          header: "Hours per Week",
          cell: (item) => item.getValue(),
        },
      ];

      return [...defaultColumns, ...customColumns];
    }, [suppliers, abilities, customColumns, params]);

    const renderContextMenu = useCallback(
      (row: Contractor) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.contractor(
                    row.supplierContactId!
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Contractor
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "resources")}
              onClick={() => {
                navigate(
                  `${path.to.deleteContractor(
                    row.supplierContactId!
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Contractor
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<Contractor>
        data={data}
        count={count}
        columns={columns}
        primaryAction={
          permissions.can("create", "resources") && (
            <New label="Contractor" to={`new?${params.toString()}`} />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Contractors"
      />
    );
  }
);

ContractorsTable.displayName = "ContractorsTable";
export default ContractorsTable;
