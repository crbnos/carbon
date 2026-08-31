import { Button, HStack, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuAward,
  LuCalendarClock,
  LuCalendarDays,
  LuPencil,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, New, Table } from "~/components";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { useDateFormatter, usePermissions } from "~/hooks";
import type { Ability } from "~/modules/resources";
import { path } from "~/utils/path";
import EmployeeAbilityStatus, {
  getEmployeeAbilityStatus
} from "./EmployeeAbilityStatus";

type AbilityEmployee = NonNullable<Ability["employeeAbility"]>[number];

type AbilityEmployeesTableProps = {
  ability: Ability;
};

const AbilityEmployeesTable = memo(
  ({ ability }: AbilityEmployeesTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const { formatDate } = useDateFormatter();
    const { getFilter } = useFilters();

    const rows = useMemo(
      () => ability.employeeAbility ?? [],
      [ability.employeeAbility]
    );

    const statusFilterKey = getFilter("status").join(",");

    const filteredRows = useMemo(() => {
      if (!statusFilterKey) return rows;
      const selected = new Set(statusFilterKey.split(","));
      const asOf = new Date();
      return rows.filter((row) =>
        selected.has(getEmployeeAbilityStatus(row, asOf).kind)
      );
    }, [rows, statusFilterKey]);

    const columns = useMemo<ColumnDef<AbilityEmployee>[]>(() => {
      return [
        {
          accessorKey: "employeeId",
          header: t`Employee`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.employeeId} />
          ),
          meta: {
            icon: <LuUser />
          }
        },
        {
          id: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <EmployeeAbilityStatus employeeAbility={row.original} />
          ),
          meta: {
            filterHeader: t`Status`,
            icon: <LuAward />,
            // Values must match getEmployeeAbilityStatus's `kind`.
            filter: {
              type: "static",
              isArray: true,
              options: [
                { value: "qualified", label: t`Qualified` },
                { value: "expiring", label: t`Expiring Soon` },
                { value: "expired", label: t`Expired` }
              ]
            }
          }
        },
        {
          accessorKey: "lastTrainingDate",
          header: t`Last Training`,
          cell: ({ row }) =>
            row.original.lastTrainingDate ? (
              formatDate(row.original.lastTrainingDate)
            ) : (
              <span className="text-muted-foreground">&mdash;</span>
            ),
          meta: {
            icon: <LuCalendarDays />
          }
        },
        {
          accessorKey: "expiresAt",
          header: t`Expires`,
          cell: ({ row }) =>
            row.original.expiresAt ? (
              formatDate(row.original.expiresAt)
            ) : (
              <span className="text-muted-foreground">&mdash;</span>
            ),
          meta: {
            icon: <LuCalendarClock />
          }
        }
      ];
    }, [t, formatDate]);

    const renderContextMenu = useCallback<
      (row: AbilityEmployee) => JSX.Element
    >(
      (row) => (
        <>
          <MenuItem
            disabled={!permissions.can("update", "resources")}
            onClick={() => {
              navigate(path.to.employeeAbility(ability.id, row.id));
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Employee Ability</Trans>
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("update", "resources")}
            onClick={() => {
              navigate(path.to.deleteEmployeeAbility(ability.id, row.id));
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Remove Employee</Trans>
          </MenuItem>
        </>
      ),
      [ability.id, navigate, permissions]
    );

    return (
      <Table<AbilityEmployee>
        data={filteredRows}
        columns={columns}
        count={statusFilterKey ? filteredRows.length : rows.length}
        isFiltered={!!statusFilterKey}
        primaryAction={
          <HStack>
            <Button
              variant="secondary"
              leftIcon={<LuPencil />}
              onClick={() => navigate(path.to.abilityDetails(ability.id))}
            >
              <Trans>Edit Ability</Trans>
            </Button>
            {permissions.can("update", "resources") && (
              <New
                label={t`Employee`}
                to={path.to.newEmployeeAbility(ability.id)}
              />
            )}
          </HStack>
        }
        renderContextMenu={renderContextMenu}
        title={ability.name}
      />
    );
  }
);

AbilityEmployeesTable.displayName = "AbilityEmployeesTable";
export default AbilityEmployeesTable;
