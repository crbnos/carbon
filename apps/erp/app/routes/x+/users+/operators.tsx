import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Checkbox, MenuIcon, MenuItem } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBriefcase,
  LuKey,
  LuToggleRight,
  LuUser,
  LuUserCheck
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { EmployeeAvatar, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import {
  getConsoleOperators,
  getEmployeeTypes
} from "~/modules/users/users.service.server";
import type { ListItem } from "~/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Operators`,
  to: path.to.operators
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "users",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [operators, employeeTypes] = await Promise.all([
    getConsoleOperators({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getEmployeeTypes()
  ]);

  if (operators.error) {
    throw redirect(
      path.to.users,
      await flash(
        request,
        error(operators.error, "Error loading console operators")
      )
    );
  }

  return {
    count: operators.count ?? 0,
    operators: operators.data ?? [],
    employeeTypes: employeeTypes.data ?? []
  };
}

type Operator = NonNullable<
  Awaited<ReturnType<typeof getConsoleOperators>>["data"]
>[number];

const OperatorsTable = memo(
  ({
    data,
    count,
    employeeTypes
  }: {
    data: Operator[];
    count: number;
    employeeTypes: ListItem[];
  }) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [params] = useUrlParams();

    const employeeTypesById = useMemo(
      () =>
        employeeTypes.reduce<Record<string, ListItem>>((acc, type) => {
          acc[type.id] = type;
          return acc;
        }, {}),
      [employeeTypes]
    );

    const columns = useMemo<ColumnDef<Operator>[]>(
      () => [
        {
          header: "Operator",
          cell: ({ row }) => (
            <EmployeeAvatar size="sm" employeeId={row.original.id} />
          ),
          meta: {
            icon: <LuUser />
          }
        },
        {
          accessorKey: "firstName",
          header: "First Name",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUserCheck />
          }
        },
        {
          accessorKey: "lastName",
          header: "Last Name",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUserCheck />
          }
        },
        {
          id: "employeeTypeId",
          header: "Employee Type",
          cell: ({ row }) => (
            <Enumerable
              value={
                employeeTypesById[row.original.employeeTypeId!]?.name ?? ""
              }
            />
          ),
          meta: {
            icon: <LuBriefcase />
          }
        },
        {
          accessorKey: "active",
          header: "Active",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static" as const,
              options: [
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" }
              ]
            },
            icon: <LuToggleRight />
          }
        }
      ],
      [employeeTypesById]
    );

    const renderContextMenu = useCallback(
      (row: Operator) => (
        <>
          <MenuItem
            onClick={() =>
              navigate(
                `${path.to.operatorResetPin(row.id!)}?${params.toString()}`
              )
            }
            disabled={!permissions.can("update", "users")}
          >
            <MenuIcon icon={<LuKey />} />
            Reset PIN
          </MenuItem>
          <MenuItem
            onClick={() =>
              navigate(`${path.to.operator(row.id!)}?${params.toString()}`)
            }
            disabled={!permissions.can("update", "users")}
          >
            <MenuIcon icon={<LuUser />} />
            Convert to Full User
          </MenuItem>
        </>
      ),
      [navigate, params, permissions]
    );

    return (
      <Table<Operator>
        count={count}
        columns={columns}
        data={data}
        primaryAction={
          permissions.can("create", "users") && (
            <New label={t`Operator`} to={`new?${params.toString()}`} />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Operators"
      />
    );
  }
);

OperatorsTable.displayName = "OperatorsTable";

export default function ConsoleOperatorsRoute() {
  const { count, operators, employeeTypes } = useLoaderData<typeof loader>();

  return (
    <>
      <OperatorsTable
        data={operators}
        count={count}
        employeeTypes={employeeTypes}
      />
      <Outlet />
    </>
  );
}
