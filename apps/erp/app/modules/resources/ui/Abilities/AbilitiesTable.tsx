import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuAward,
  LuCalendarClock,
  LuPencil,
  LuTrash,
  LuUsers
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatarGroup, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { Abilities } from "~/modules/resources";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type Ability = Abilities[number];

type AbilitiesTableProps = {
  data: Abilities;
  count: number;
};

const AbilitiesTable = memo(({ data, count }: AbilitiesTableProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const permissions = usePermissions();
  const [people] = usePeople();

  const employeeOptions = useMemo(
    () => people.map((person) => ({ value: person.id, label: person.name })),
    [people]
  );

  const columns = useMemo<ColumnDef<Ability>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: t`Ability`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.ability(row.original.id!)}>
            <Enumerable value={row.original.name} className="cursor-pointer" />
          </Hyperlink>
        ),
        meta: {
          icon: <LuAward />
        }
      },
      {
        accessorKey: "recertifyEveryDays",
        header: t`Recertify Every (Days)`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.recertifyEveryDays ?? t`Never`}
          </span>
        ),
        meta: {
          icon: <LuCalendarClock />
        }
      },
      {
        id: "employees",
        header: t`Qualified Employees`,
        cell: ({ row }) => {
          // Qualified = has an ability row ∧ not expired. Presence of the row
          // is the qualification — there is no separate training gate.
          const today = new Date().toISOString().slice(0, 10);
          const employeeIds = (row.original.employeeAbility ?? [])
            .filter((ea) => !ea.expiresAt || ea.expiresAt >= today)
            .map((ea) => ea.employeeId);
          return employeeIds.length > 0 ? (
            <EmployeeAvatarGroup employeeIds={employeeIds} />
          ) : (
            <span className="text-muted-foreground">&mdash;</span>
          );
        },
        meta: {
          icon: <LuUsers />,
          filter: {
            type: "static",
            options: employeeOptions,
            isArray: true
          }
        }
      }
    ];
  }, [t, employeeOptions]);

  const renderContextMenu = useCallback<(row: Ability) => JSX.Element>(
    (row) => (
      <>
        <MenuItem
          onClick={() => {
            navigate(`${path.to.ability(row.id!)}?${params?.toString()}`);
          }}
        >
          <MenuIcon icon={<LuPencil />} />
          <Trans>View Ability</Trans>
        </MenuItem>
        <MenuItem
          destructive
          disabled={!permissions.can("delete", "resources")}
          onClick={() => {
            navigate(`${path.to.deleteAbility(row.id!)}?${params?.toString()}`);
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Deactivate Ability</Trans>
        </MenuItem>
      </>
    ),
    [navigate, params, permissions]
  );

  return (
    <Table<Ability>
      data={data}
      columns={columns}
      count={count ?? 0}
      primaryAction={
        permissions.can("create", "resources") && (
          <New label={t`Ability`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Abilities`}
      table="ability"
      withSavedView
    />
  );
});

AbilitiesTable.displayName = "AbilitiesTable";
export default AbilitiesTable;
