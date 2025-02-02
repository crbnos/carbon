import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuBrain, LuClock, LuPencil, LuTrash, LuUsers } from "react-icons/lu";
import { EmployeeAvatarGroup, Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { Abilities, AbilityDatum } from "../../types";

type AbilitiesTableProps = {
  data: Abilities;
  count: number;
};

const AbilitiesTable = memo(({ data, count }: AbilitiesTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();

  const rows = data.map((row) => ({
    id: row.id,
    name: row.name,
    // @ts-ignore
    weeks: row.curve?.data.at(-1).week,
    curve: row.curve as { data: AbilityDatum[] },
    shadowWeeks: row.shadowWeeks,
    employees: row.employeeAbility?.map(
      (employeeAbility) => employeeAbility.employeeId
    ),
  }));

  const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Ability",
        cell: ({ row }) => (
          <Hyperlink to={path.to.ability(row.original.id)}>
            <Badge variant="secondary" className="cursor-pointer">
              {row.original.name}
            </Badge>
          </Hyperlink>
        ),
        meta: {
          icon: <LuBrain />,
        },
      },
      {
        header: "Employees",
        // accessorKey: undefined, // makes the column unsortable
        cell: ({ row }) => (
          <EmployeeAvatarGroup
            employeeIds={row.original.employees}
            size="xs"
            limit={3}
          />
        ),
        meta: {
          icon: <LuUsers />,
        },
      },
      {
        header: "Time to Learn",
        cell: ({ row }) => `${row.original.weeks} weeks`,
        meta: {
          icon: <LuClock />,
        },
      },
    ];
  }, []);

  const renderContextMenu = useCallback(
    (row: (typeof rows)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(path.to.ability(row.id));
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Ability
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "resources")}
            onClick={() => {
              navigate(path.to.deleteAbility(row.id));
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Ability
          </MenuItem>
        </>
      );
    },
    [navigate, permissions]
  );

  return (
    <Table<(typeof rows)[number]>
      data={rows}
      count={count}
      columns={columns}
      primaryAction={
        permissions.can("create", "resources") && (
          <New label="Ability" to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title="Abilities"
    />
  );
});

AbilitiesTable.displayName = "AbilitiesTable";
export default AbilitiesTable;
