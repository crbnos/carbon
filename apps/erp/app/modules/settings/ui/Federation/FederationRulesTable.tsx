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
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuArchive,
  LuBookOpen,
  LuCalendar,
  LuEye,
  LuFingerprint,
  LuGlobe,
  LuPencil,
  LuPlug,
  LuShield,
  LuTag,
  LuUser
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { DateTime, EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import type { InfiniteOptions } from "~/components/Table";
import { usePermissions, useUrlParams } from "~/hooks";
import type { FederationRuleRow } from "~/modules/settings/types";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import ArchivedToggle, { useShowArchived } from "./ArchivedToggle";

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
    const showArchived = useShowArchived();
    const canEdit = permissions.can("update", "users");

    const columns = useMemo<ColumnDef<FederationRuleRow>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={`${row.original.id}?${params.toString()}`}>
              {row.original.name}
            </Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuTag />
          }
        },
        {
          id: "issuer",
          header: t`Issuer`,
          cell: ({ row }) => (
            <span className="font-mono text-sm text-muted-foreground">
              {row.original.federationIssuer?.name ?? "—"}
            </span>
          ),
          meta: {
            icon: <LuGlobe />,
            exportValue: (row) => row.federationIssuer?.name ?? null
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
                {scopeCount === 0 ? (
                  t`No Access`
                ) : (
                  <Plural
                    value={scopeCount}
                    one="# permission"
                    other="# permissions"
                  />
                )}
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
            mobile: "P2",
            icon: <LuCalendar />
          }
        }
      ];
    }, [params, people, t]);

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
            <MenuIcon icon={row.archivedAt ? <LuEye /> : <LuPencil />} />
            {row.archivedAt ? (
              <Trans>View Federation Rule</Trans>
            ) : (
              <Trans>Edit Federation Rule</Trans>
            )}
          </MenuItem>
          {!row.archivedAt && (
            <MenuItem
              destructive
              disabled={!canEdit}
              onClick={() => {
                navigate(
                  `${path.to.archiveFederationRule(row.id)}?${params?.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuArchive />} />
              <Trans>Archive Federation Rule</Trans>
            </MenuItem>
          )}
        </>
      ),
      [canEdit, navigate, params]
    );

    return (
      <Table<FederationRuleRow>
        data={data}
        infinite={infinite}
        columns={columns}
        count={count ?? 0}
        primaryAction={
          <HStack>
            <ArchivedToggle />
            <Button leftIcon={<LuBookOpen />} variant="secondary" asChild>
              <a
                href={path.to.identityFederationDocs}
                target="_blank"
                rel="noreferrer"
              >
                <Trans>Docs</Trans>
              </a>
            </Button>
            {canEdit && !showArchived && (
              <>
                <Button leftIcon={<LuPlug />} variant="secondary" asChild>
                  <Link to={`${path.to.connectWorkload}?${params.toString()}`}>
                    <Trans>Connect workload</Trans>
                  </Link>
                </Button>
                <New
                  label={t`Federation Rule`}
                  to={`${path.to.newFederationRule}?${params.toString()}`}
                />
              </>
            )}
          </HStack>
        }
        renderContextMenu={renderContextMenu}
        title={showArchived ? t`Archived Rules` : t`Federation Rules`}
      />
    );
  }
);

FederationRulesTable.displayName = "FederationRulesTable";
export default FederationRulesTable;
