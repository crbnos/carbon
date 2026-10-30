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
  LuBookOpen,
  LuCalendar,
  LuCircleAlert,
  LuCloud,
  LuFingerprint,
  LuGlobe,
  LuPencil,
  LuShield,
  LuTag,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import type { InfiniteOptions } from "~/components/Table";
import { usePermissions, useUrlParams } from "~/hooks";
import type { FederationRuleRow } from "~/modules/settings/types";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type FederationRulesTableProps = {
  data: FederationRuleRow[];
  count: number;
  infinite: InfiniteOptions;
};

function getScopeCount(rule: FederationRuleRow): number {
  const { scopes } = rule;
  return scopes && typeof scopes === "object" && !Array.isArray(scopes)
    ? Object.keys(scopes).length
    : 0;
}

const FederationRulesTable = memo(
  ({ data, count, infinite }: FederationRulesTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const [params] = useUrlParams();
    const permissions = usePermissions();
    const [people] = usePeople();

    const columns = useMemo<ColumnDef<FederationRuleRow>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>{row.original.name}</Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuTag />
          }
        },
        {
          accessorKey: "provider",
          header: t`Provider`,
          cell: ({ row }) => (
            <Badge variant="secondary">{row.original.provider}</Badge>
          ),
          meta: {
            icon: <LuCloud />
          }
        },
        {
          accessorKey: "issuer",
          header: t`Issuer`,
          cell: ({ row }) => (
            <span className="font-mono text-sm text-muted-foreground">
              {row.original.issuer}
            </span>
          ),
          meta: {
            icon: <LuGlobe />
          }
        },
        {
          accessorKey: "subject",
          header: t`Subject`,
          cell: ({ row }) => (
            <span className="font-mono text-sm">
              {row.original.subject ?? "—"}
            </span>
          ),
          meta: {
            icon: <LuFingerprint />
          }
        },
        {
          id: "scopes",
          header: t`Scopes`,
          cell: ({ row }) => {
            const scopeCount = getScopeCount(row.original);
            return (
              <Badge variant="secondary">
                {scopeCount === 0 ? t`No Access` : t`${scopeCount} permissions`}
              </Badge>
            );
          },
          meta: {
            icon: <LuShield />,
            exportValue: (row) => {
              const scopeCount = getScopeCount(row);
              return scopeCount === 0
                ? t`No Access`
                : t`${scopeCount} permissions`;
            }
          }
        },
        {
          accessorKey: "lastExchangeAt",
          header: t`Last Exchange`,
          cell: ({ row }) =>
            row.original.lastExchangeAt ? (
              <DateTime value={row.original.lastExchangeAt} />
            ) : (
              <span className="text-muted-foreground">
                <Trans>Never</Trans>
              </span>
            ),
          meta: {
            mobile: "P2",
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "lastFailureReason",
          header: t`Last Refusal`,
          cell: ({ row }) =>
            row.original.lastFailureReason ? (
              <Badge variant="destructive">
                {row.original.lastFailureReason}
              </Badge>
            ) : null,
          meta: {
            icon: <LuCircleAlert />
          }
        },
        {
          id: "createdBy",
          header: t`Created By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
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

    const renderContextMenu = useCallback(
      (row: FederationRuleRow) => (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            onClick={() => {
              navigate(
                `${path.to.federationRule(row.id)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Federation Rule</Trans>
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            destructive
            onClick={() => {
              navigate(
                `${path.to.deleteFederationRule(row.id)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Federation Rule</Trans>
          </MenuItem>
        </>
      ),
      [navigate, params]
    );

    return (
      <Table<FederationRuleRow>
        data={data}
        infinite={infinite}
        columns={columns}
        count={count ?? 0}
        primaryAction={
          <HStack>
            {permissions.can("update", "users") && (
              <New
                label={t`Federation Rule`}
                to={`${path.to.newFederationRule}?${params.toString()}`}
              />
            )}
            <Button leftIcon={<LuBookOpen />} variant="secondary" asChild>
              <a
                href={path.to.identityFederationDocs}
                target="_blank"
                rel="noreferrer"
              >
                <Trans>Docs</Trans>
              </a>
            </Button>
          </HStack>
        }
        renderContextMenu={renderContextMenu}
        title={t`Identity Federation`}
      />
    );
  }
);

FederationRulesTable.displayName = "FederationRulesTable";
export default FederationRulesTable;
