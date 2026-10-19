// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  HStack,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
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
import { useNavigate } from "react-router";
import { DateTime, EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import type { ApiKey } from "~/modules/settings/types";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type ApiKeysTableProps = {
  data: ApiKey[];
  count: number;
};

/** The key's grants that give access (a None grant gives none). */
function grantCount(apiKey: ApiKey): number {
  return (apiKey.permission ?? []).filter((g) => g.level !== "None").length;
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
  const { t } = useLingui();
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const permissions = usePermissions();
  const [people] = usePeople();

  const columns = useMemo<ColumnDef<ApiKey>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id!}>{row.original.name}</Hyperlink>
        ),
        meta: {
          mobile: "P1",
          icon: <LuTag />
        }
      },
      {
        id: "keyPreview",
        header: t`Key`,
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
        header: t`Access`,
        cell: ({ row }) => {
          const count = grantCount(row.original);
          return (
            <Badge variant="secondary">
              {count === 0 ? t`No Access` : t`${count} grants`}
            </Badge>
          );
        },
        meta: {
          icon: <LuShield />,
          exportValue: (row) => {
            const count = grantCount(row);
            return count === 0 ? t`No Access` : t`${count} grants`;
          }
        }
      },
      {
        id: "rateLimit",
        header: t`Rate Limit`,
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
        header: t`Created By`,
        cell: ({ row }) => {
          return <EmployeeAvatar employeeId={row.original.createdBy} />;
        },
        meta: {
          mobile: "P3",
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
        header: t`Expires`,
        cell: ({ row }) => {
          const expiresAt = (row.original as any).expiresAt as string | null;
          if (!expiresAt)
            return (
              <span className="text-muted-foreground">
                <Trans>Never</Trans>
              </span>
            );
          const isExpired = new Date(expiresAt) < new Date();
          return (
            <Badge variant={isExpired ? "destructive" : "secondary"}>
              {isExpired ? (
                t`Expired`
              ) : (
                <DateTime value={expiresAt} variant="date" />
              )}
            </Badge>
          );
        },
        meta: {
          mobile: "P2",
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "createdAt",
        header: t`Created At`,
        cell: (item) => (
          <DateTime value={item.getValue<string>()} variant="date" />
        ),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];
  }, [people, t]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            onClick={() => {
              navigate(`${path.to.apiKey(row.id!)}?${params?.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit API Key</Trans>
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            destructive
            onClick={() => {
              navigate(
                `${path.to.deleteApiKey(row.id!)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete API Key</Trans>
          </MenuItem>
        </>
      );
    },

    [navigate, params, permissions]
  );

  return (
    <Table<ApiKey>
      data={data}
      columns={columns}
      count={count ?? 0}
      primaryAction={
        <HStack>
          {permissions.has({ "settings.apiKeys": "Edit" }) && (
            <New
              label={t`API Key`}
              to={`${path.to.newApiKey}?${params.toString()}`}
            />
          )}
          <Button leftIcon={<LuCode />} variant="secondary" asChild>
            <a href={path.to.apiDocs} target="_blank" rel="noreferrer">
              <Trans>API Docs</Trans>
            </a>
          </Button>
        </HStack>
      }
      renderContextMenu={renderContextMenu}
      title={t`API Keys`}
    />
  );
});

ApiKeysTable.displayName = "ApiKeysTable";
export default ApiKeysTable;
