import {
  Badge,
  DropdownMenuIcon,
  HStack,
  MenuItem,
  Progress,
} from "@carbon/react";
import { useNavigate, useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { EmployeeAvatar, New, Table } from "~/components";
import { usePermissions } from "~/hooks";
import { AbilityEmployeeStatus, type AbilityEmployees } from "../../types";

import { path } from "~/utils/path";

type AbilityEmployeeTableProps = {
  employees: AbilityEmployees;
  weeks: number;
};

const AbilityEmployeesTable = ({
  employees,
  weeks,
}: AbilityEmployeeTableProps) => {
  const { abilityId } = useParams();

  if (!abilityId) throw new Error("abilityId not found");

  const navigate = useNavigate();
  const permissions = usePermissions();

  const rows = useMemo(
    () =>
      Array.isArray(employees)
        ? employees.map((employee) => {
            if (Array.isArray(employee)) {
              throw new Error("AbilityEmployeesTable: user is an array");
            }

            return {
              id: employee.id,
              employeeId: employee.employeeId,
              status: employee.trainingCompleted
                ? AbilityEmployeeStatus.Complete
                : employee.trainingDays
                ? AbilityEmployeeStatus.InProgress
                : AbilityEmployeeStatus.NotStarted,
              percentage: (employee.trainingDays / 5 / weeks) * 100,
            };
          })
        : [],
    [employees, weeks]
  );

  console.log();

  const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <HStack>
            <EmployeeAvatar employeeId={row.original.employeeId} />
          </HStack>
        ),
      },
      {
        header: "Training Status",
        cell: ({ row }) => {
          const status = row.original.status;
          return (
            <Badge
              variant={
                status === AbilityEmployeeStatus.Complete
                  ? "default"
                  : status === AbilityEmployeeStatus.InProgress
                  ? "outline"
                  : "secondary"
              }
            >
              {status}
            </Badge>
          );
        },
      },
      {
        header: "Training Progress",
        width: 200,
        cell: ({ row }) => {
          const percentage = row.original.percentage;
          return (
            <Progress
              className="max-w-[200px]"
              value={
                row.original.status === AbilityEmployeeStatus.Complete
                  ? 100
                  : percentage
              }
            />
          );
        },
      },
    ];
  }, []);

  const renderContextMenu = useCallback(
    (row: (typeof rows)[number]) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "resources")}
            onClick={() => {
              navigate(path.to.employeeAbility(abilityId, row.id));
            }}
          >
            <DropdownMenuIcon icon={<LuPencil />} />
            Edit Employee Ability
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "resources")}
            onClick={() => {
              navigate(path.to.deleteEmployeeAbility(abilityId, row.id));
            }}
          >
            <DropdownMenuIcon icon={<LuTrash />} />
            Delete Employee Ability
          </MenuItem>
        </>
      );
    },
    [abilityId, navigate, permissions]
  );

  if (!abilityId) return null;
  return (
    <Table<(typeof rows)[number]>
      data={rows}
      count={rows.length}
      columns={columns}
      primaryAction={<New to="employee/new" label="Employee" />}
      renderContextMenu={renderContextMenu}
      withPagination={false}
      withSearch={false}
    />
  );
};

export default AbilityEmployeesTable;
