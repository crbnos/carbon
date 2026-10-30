// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  HStack,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuArchive,
  LuCalendar,
  LuCloud,
  LuEye,
  LuGlobe,
  LuKeyRound,
  LuListTree,
  LuPencil,
  LuTag
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, Hyperlink, New, Table } from "~/components";
import type { InfiniteOptions } from "~/components/Table";
import { usePermissions, useUrlParams } from "~/hooks";
import type { FederationIssuerRow } from "~/modules/settings/types";
import { path } from "~/utils/path";
import ArchivedToggle, { useShowArchived } from "./ArchivedToggle";

type FederationIssuersTableProps = {
  data: FederationIssuerRow[];
  count: number;
  infinite: InfiniteOptions;
};

const FederationIssuersTable = memo(
  ({ data, count, infinite }: FederationIssuersTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const [params] = useUrlParams();
    const permissions = usePermissions();
    const showArchived = useShowArchived();
    const canEdit = permissions.can("update", "users");

    const columns = useMemo<ColumnDef<FederationIssuerRow>[]>(() => {
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
          header: t`Issuer URL`,
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
          accessorKey: "jwksSource",
          header: t`JWKS Source`,
          cell: ({ row }) => (
            <Badge variant="outline">{row.original.jwksSource}</Badge>
          ),
          meta: {
            icon: <LuKeyRound />
          }
        },
        {
          id: "rules",
          header: t`Rules`,
          cell: ({ row }) => row.original.federationRule?.length ?? 0,
          meta: {
            mobile: "P2",
            icon: <LuListTree />,
            exportValue: (row) => row.federationRule?.length ?? 0
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
    }, [params, t]);

    const renderContextMenu = useCallback(
      (row: FederationIssuerRow) => (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            onClick={() => {
              navigate(
                `${path.to.federationIssuer(row.id)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={row.archivedAt ? <LuEye /> : <LuPencil />} />
            {row.archivedAt ? (
              <Trans>View Issuer</Trans>
            ) : (
              <Trans>Edit Issuer</Trans>
            )}
          </MenuItem>
          {!row.archivedAt && (
            <MenuItem
              destructive
              disabled={!canEdit}
              onClick={() => {
                navigate(
                  `${path.to.archiveFederationIssuer(row.id)}?${params?.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuArchive />} />
              <Trans>Archive Issuer</Trans>
            </MenuItem>
          )}
        </>
      ),
      [canEdit, navigate, params]
    );

    return (
      <Table<FederationIssuerRow>
        data={data}
        infinite={infinite}
        columns={columns}
        count={count ?? 0}
        primaryAction={
          <HStack>
            <ArchivedToggle />
            {canEdit && !showArchived && (
              <New
                label={t`Issuer`}
                to={`${path.to.newFederationIssuer}?${params.toString()}`}
              />
            )}
          </HStack>
        }
        renderContextMenu={renderContextMenu}
        title={showArchived ? t`Archived Issuers` : t`Issuers`}
      />
    );
  }
);

FederationIssuersTable.displayName = "FederationIssuersTable";
export default FederationIssuersTable;
