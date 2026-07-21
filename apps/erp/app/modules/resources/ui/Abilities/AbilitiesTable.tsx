import { Checkbox, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuAward,
  LuCalendarClock,
  LuCheck,
  LuPencil,
  LuTrash,
  LuUsers
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { Abilities } from "~/modules/resources";
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
        id: "qualifiedEmployees",
        header: t`Qualified Employees`,
        cell: ({ row }) => {
          // Qualified = active (query-filtered) ∧ training completed ∧ not
          // expired — counting assigned-but-untrained people here would
          // overstate real capacity
          const today = new Date().toISOString().slice(0, 10);
          const qualified = (row.original.employeeAbility ?? []).filter(
            (ea) =>
              ea.trainingCompleted && (!ea.expiresAt || ea.expiresAt >= today)
          ).length;
          return <span className="tabular-nums">{qualified}</span>;
        },
        meta: {
          icon: <LuUsers />
        }
      },
      {
        accessorKey: "active",
        header: t`Active`,
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          filter: {
            type: "static",
            options: [
              { value: "true", label: "Active" },
              { value: "false", label: "Inactive" }
            ]
          },
          pluralHeader: t`Active Statuses`,
          icon: <LuCheck />
        }
      }
    ];
  }, [t]);

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
