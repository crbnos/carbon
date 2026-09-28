import { Checkbox, MenuIcon, MenuItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBox,
  LuCircleCheck,
  LuPencil,
  LuScrollText,
  LuSquareUser,
  LuTrash,
  LuUsers
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { ComplianceStatement } from "../../types";

type ComplianceStatementsTableProps = {
  data: ComplianceStatement[];
  count: number;
};

const ComplianceStatementsTable = memo(
  ({ data, count }: ComplianceStatementsTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();

    const columns = useMemo<ColumnDef<ComplianceStatement>[]>(
      () => [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>{row.original.name}</Hyperlink>
          ),
          meta: {
            icon: <LuScrollText />
          }
        },
        {
          accessorKey: "appliesToAllCustomers",
          header: t`All Customers`,
          cell: ({ row }) => (
            <Checkbox isChecked={row.original.appliesToAllCustomers} disabled />
          ),
          meta: {
            icon: <LuUsers />
          }
        },
        {
          id: "customers",
          header: t`Customers`,
          cell: ({ row }) =>
            row.original.complianceStatementAssignment.filter(
              (assignment) => assignment.customerId
            ).length,
          meta: {
            icon: <LuSquareUser />,
            exportValue: (row) =>
              row.complianceStatementAssignment.filter(
                (assignment) => assignment.customerId
              ).length
          }
        },
        {
          id: "items",
          header: t`Items`,
          cell: ({ row }) =>
            row.original.complianceStatementAssignment.filter(
              (assignment) => assignment.itemId
            ).length,
          meta: {
            icon: <LuBox />,
            exportValue: (row) =>
              row.complianceStatementAssignment.filter(
                (assignment) => assignment.itemId
              ).length
          }
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: ({ row }) => (
            <Checkbox isChecked={row.original.active} disabled />
          ),
          meta: {
            icon: <LuCircleCheck />
          }
        }
      ],
      [t]
    );

    const renderContextMenu = useCallback(
      (row: ComplianceStatement) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.complianceStatement(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {t`Edit Statement`}
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "quality")}
              onClick={() => {
                navigate(
                  `${path.to.deleteComplianceStatement(
                    row.id
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              {t`Delete Statement`}
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions, t]
    );

    const emptyState = params.get("search") ? undefined : (
      <>
        <div className="flex justify-center items-center h-12 w-12 rounded-full bg-muted text-muted-foreground -mt-[10dvh]">
          <LuScrollText className="h-6 w-6 shrink-0" />
        </div>
        <span className="text-xs font-mono font-light text-muted-foreground uppercase text-center max-w-xs text-balance">
          {t`Add the statements your customers require on certificates — e.g. DFARS 252.225-7009 specialty metals, DFARS 252.246-7008 counterfeit parts, RoHS, REACH.`}
        </span>
      </>
    );

    return (
      <Table<ComplianceStatement>
        data={data}
        columns={columns}
        count={count}
        emptyState={emptyState}
        primaryAction={
          permissions.can("create", "quality") && (
            <New
              label={t`Compliance Statement`}
              to={`${path.to.newComplianceStatement}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Compliance Statements`}
      />
    );
  }
);

ComplianceStatementsTable.displayName = "ComplianceStatementsTable";
export default ComplianceStatementsTable;
