// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Checkbox, MenuIcon, MenuItem, RecordOutlet } from "@carbon/react";
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
import { useLoaderData, useNavigate } from "react-router";
import { EmployeeAvatar, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import type { InfiniteOptions } from "~/components/Table";
import { usePermissions, useUrlParams } from "~/hooks";
import type { getConsoleOperators } from "~/modules/users/users.service";
import { getEmployeeTypes } from "~/modules/users/users.service";
import type { ListItem } from "~/types";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { consoleOperatorsList } from "~/utils/list-registry/users.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Operators`,
  to: path.to.operators
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, consoleOperatorsList, {
    dataKey: "operators",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => {
      const employeeTypes = await getEmployeeTypes(client, companyId);
      return { employeeTypes: employeeTypes.data ?? [] };
    },
    onError: {
      redirectTo: path.to.users,
      message: "Error loading console operators"
    }
  });
}

type Operator = NonNullable<
  Awaited<ReturnType<typeof getConsoleOperators>>["data"]
>[number];

const OperatorsTable = memo(
  ({
    data,
    count,
    infinite,
    employeeTypes
  }: {
    data: Operator[];
    count: number;
    infinite: InfiniteOptions;
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
            mobile: "P1",
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
            mobile: "P3",
            icon: <LuBriefcase />
          }
        },
        {
          accessorKey: "active",
          header: "Active",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            mobile: "P2",
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
        infinite={infinite}
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
  const { count, operators, infinite, employeeTypes } =
    useLoaderData<typeof loader>();

  return (
    <>
      <OperatorsTable
        data={operators}
        count={count}
        infinite={infinite}
        employeeTypes={employeeTypes}
      />
      <RecordOutlet />
    </>
  );
}
