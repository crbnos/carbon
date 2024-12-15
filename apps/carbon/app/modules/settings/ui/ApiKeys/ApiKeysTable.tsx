import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Outlet, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuKey,
  LuPencil,
  LuTag,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { type ApiKey } from "~/modules/settings";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type ApiKeysTableProps = {
  data: ApiKey[];
  count: number;
};

const ApiKeysTable = memo(({ data, count }: ApiKeysTableProps) => {
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const permissions = usePermissions();
  const [people] = usePeople();

  const columns = useMemo<ColumnDef<ApiKey>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <Hyperlink to={row.original.id!}>{row.original.name}</Hyperlink>
        ),
        meta: {
          icon: <LuTag />,
        },
      },
      {
        accessorKey: "key",
        header: "Key",
        cell: (item) => (
          <Badge variant="secondary">{item.getValue<string>()}</Badge>
        ),
        meta: {
          icon: <LuKey />,
        },
      },
      {
        id: "createdBy",
        header: "Created By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          icon: <LuUser />,
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name,
            })),
          },
        },
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
    ];
  }, [people]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.apiKey(row.id!)}?${params?.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit API Key
          </MenuItem>
          <MenuItem
            destructive
            onClick={() => {
              navigate(
                `${path.to.deleteApiKey(row.id!)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete API Key
          </MenuItem>
        </>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, params, permissions]
  );

  return (
    <>
      <Table<ApiKey>
        data={data}
        columns={columns}
        count={count ?? 0}
        primaryAction={
          permissions.can("update", "users") && (
            <New
              label="API Key"
              to={`${path.to.newApiKey}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
      />
      <Outlet />
    </>
  );
});

ApiKeysTable.displayName = "ApiKeysTable";
export default ApiKeysTable;
