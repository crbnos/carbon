import { Badge, Button, HStack, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuCode,
  LuGauge,
  LuKey,
  LuPencil,
  LuShield,
  LuTag,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { Link, Outlet, useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import type { ApiKey } from "~/modules/settings";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type ApiKeysTableProps = {
  data: ApiKey[];
  count: number;
};

function getScopeCount(scopes: Record<string, string[]> | null): number {
  if (!scopes) return 0;
  return Object.keys(scopes).length;
}

function formatRateLimit(limit: number, window: string): string {
  const windowLabels: Record<string, string> = {
    "1m": "/min",
    "1h": "/hr",
    "1d": "/day"
  };
  return `${limit}${windowLabels[window] ?? "/hr"}`;
}

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
          icon: <LuTag />
        }
      },
      {
        id: "keyPreview",
        header: "Key",
        cell: ({ row }) => {
          const preview = (row.original as any).keyPreview as string | null;
          return (
            <span className="font-mono text-sm text-muted-foreground">
              {preview ? `crbn_•••${preview}` : "crbn_•••••"}
            </span>
          );
        },
        meta: {
          icon: <LuKey />
        }
      },
      {
        id: "scopes",
        header: "Scopes",
        cell: ({ row }) => {
          const scopes = (row.original as any).scopes as Record<
            string,
            string[]
          > | null;
          const scopeCount = getScopeCount(scopes);
          return (
            <Badge variant="secondary">
              {scopeCount === 0 ? "No Access" : `${scopeCount} permissions`}
            </Badge>
          );
        },
        meta: {
          icon: <LuShield />
        }
      },
      {
        id: "rateLimit",
        header: "Rate Limit",
        cell: ({ row }) => {
          const limit = (row.original as any).rateLimit as number;
          const window = (row.original as any).rateLimitWindow as string;
          return (
            <span className="text-sm text-muted-foreground">
              {formatRateLimit(limit ?? 60, window ?? "1m")}
            </span>
          );
        },
        meta: {
          icon: <LuGauge />
        }
      },
      {
        id: "createdBy",
        header: "Created By",
        cell: ({ row }) => {
          return <EmployeeAvatar employeeId={row.original.createdBy} />;
        },
        meta: {
          icon: <LuUser />,
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          }
        }
      },
      {
        id: "expiresAt",
        header: "Expires",
        cell: ({ row }) => {
          const expiresAt = (row.original as any).expiresAt as string | null;
          if (!expiresAt)
            return <span className="text-muted-foreground">Never</span>;
          const isExpired = new Date(expiresAt) < new Date();
          return (
            <Badge variant={isExpired ? "destructive" : "secondary"}>
              {isExpired ? "Expired" : formatDate(expiresAt)}
            </Badge>
          );
        },
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];
  }, [people]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
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

    [navigate, params, permissions]
  );

  return (
    <>
      <Table<ApiKey>
        data={data}
        columns={columns}
        count={count ?? 0}
        primaryAction={
          <HStack>
            {permissions.can("update", "users") && (
              <New
                label="API Key"
                to={`${path.to.newApiKey}?${params.toString()}`}
              />
            )}
            <Button leftIcon={<LuCode />} variant="secondary" asChild>
              <Link to={path.to.apiIntroduction}>API Docs</Link>
            </Button>
          </HStack>
        }
        renderContextMenu={renderContextMenu}
        title="API Keys"
      />
      <Outlet />
    </>
  );
});

ApiKeysTable.displayName = "ApiKeysTable";
export default ApiKeysTable;
