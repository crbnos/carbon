import { Badge, HStack, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Outlet, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuDatabase,
  LuPencil,
  LuTable2,
  LuTag,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import type { Webhook } from "~/modules/settings";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import { useWebhookTables } from "./WebhookForm";

type WebhooksTableProps = {
  data: Webhook[];
  count: number;
};

const WebhooksTable = memo(({ data, count }: WebhooksTableProps) => {
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const permissions = usePermissions();
  const [people] = usePeople();
  const webhookTables = useWebhookTables();

  const columns = useMemo<ColumnDef<Webhook>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex flex-col gap-1 justify-start items-start pb-1">
            <Hyperlink to={row.original.id!}>{row.original.name}</Hyperlink>
            <HStack>
              {row.original.active ? (
                <Badge variant="green">Active</Badge>
              ) : (
                <Badge variant="red">Inactive</Badge>
              )}
              <span className="text-xs text-muted-foreground font-mono">
                {row.original.url}
              </span>
            </HStack>
          </div>
        ),
        meta: {
          icon: <LuTag />,
        },
      },
      {
        accessorKey: "table",
        header: "Table",
        cell: ({ row }) => (
          <div className="flex flex-col gap-1 justify-start items-start pb-1">
            <Hyperlink
              className="flex flex-row gap-1 items-center"
              to={path.to.apiTable("js", row.original.table)}
            >
              <LuTable2 className="size-4" />
              <span className="text-sm font-medium">
                {`public.${row.original.table}`}
              </span>
            </Hyperlink>
            <HStack>
              {row.original.onInsert && <Badge variant="green">Insert</Badge>}
              {row.original.onUpdate && <Badge variant="blue">Update</Badge>}
              {row.original.onDelete && <Badge variant="red">Delete</Badge>}
            </HStack>
          </div>
        ),
        meta: {
          icon: <LuDatabase />,
          filter: {
            type: "static",
            options: webhookTables,
          },
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
  }, [people, webhookTables]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.webhook(row.id!)}?${params?.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Webhook
          </MenuItem>
          <MenuItem
            destructive
            onClick={() => {
              navigate(
                `${path.to.deleteWebhook(row.id!)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Webhook
          </MenuItem>
        </>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, params, permissions]
  );

  return (
    <>
      <Table<Webhook>
        data={data}
        columns={columns}
        count={count ?? 0}
        primaryAction={
          permissions.can("update", "users") && (
            <New
              label="Webhook"
              to={`${path.to.newWebhook}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Webhooks"
      />
      <Outlet />
    </>
  );
});

WebhooksTable.displayName = "WebhooksTable";
export default WebhooksTable;
