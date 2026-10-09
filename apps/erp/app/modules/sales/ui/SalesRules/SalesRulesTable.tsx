// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// List table for Sales → Sales Rules. Mirrors
// `~/modules/inventory/ui/StorageRules/StorageRulesTable` minus the targetType column;
// permission checks use `sales`.

import type { Json } from "@carbon/database";
import {
  Badge,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  Status
} from "@carbon/react";
import { SALES_RULE_SURFACES, type SalesRuleSurface } from "@carbon/utils";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuPencil, LuShieldCheck, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";

type SalesRuleRowView = {
  id: string;
  name: string;
  severity: "error" | "warn";
  active: boolean;
  description?: string | null;
  message: string;
  updatedAt?: string | null;
  customFields: Json;
  assignmentCount?: number;
  surfaces?: SalesRuleSurface[];
};

export const SALES_RULE_SURFACE_LABELS: Record<
  SalesRuleSurface,
  MessageDescriptor
> = {
  quoteLine: msg`Quote line`,
  salesOrderLine: msg`Sales order line`,
  salesInvoiceLine: msg`Sales invoice line`
};

type SalesRulesTableProps = {
  data: SalesRuleRowView[];
  count: number;
};

const SalesRulesTable = memo(({ data, count }: SalesRulesTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const customColumns = useCustomColumns<SalesRuleRowView>("enforcementRule");

  const rows = useMemo(() => data, [data]);

  const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
    const defaults: ColumnDef<(typeof rows)[number]>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink
            to={`${path.to.salesRule(row.original.id)}?${params.toString()}`}
          >
            <Enumerable value={row.original.name} />
          </Hyperlink>
        ),
        meta: { icon: <LuShieldCheck />, mobile: "P1" }
      },
      {
        accessorKey: "severity",
        header: t`Severity`,
        cell: ({ row }) =>
          row.original.severity === "error" ? (
            <Badge variant="red">
              <Trans>Error</Trans>
            </Badge>
          ) : (
            <Badge variant="yellow">
              <Trans>Warn</Trans>
            </Badge>
          ),
        meta: { mobile: "P3" }
      },
      {
        accessorKey: "surfaces",
        header: t`Surfaces`,
        cell: ({ row }) => {
          const surfaces =
            row.original.surfaces && row.original.surfaces.length > 0
              ? row.original.surfaces
              : [...SALES_RULE_SURFACES];
          return (
            <div className="flex items-center gap-1">
              {surfaces.map((s) => (
                <Badge key={s} variant="secondary">
                  {t(SALES_RULE_SURFACE_LABELS[s])}
                </Badge>
              ))}
            </div>
          );
        }
      },
      {
        accessorKey: "active",
        header: t`Status`,
        cell: ({ row }) =>
          row.original.active ? (
            <Status color="green">
              <Trans>Active</Trans>
            </Status>
          ) : (
            <Status color="gray">
              <Trans>Inactive</Trans>
            </Status>
          ),
        meta: { mobile: "P2" }
      },
      {
        accessorKey: "assignmentCount",
        header: t`Items`,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.assignmentCount ?? 0}
          </span>
        )
      }
    ];
    return [...defaults, ...customColumns];
  }, [customColumns, params, t]);

  const renderContextMenu = useCallback(
    (row: (typeof rows)[number]) => (
      <>
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.edit}
          disabled={!permissions.can("update", "sales")}
          onClick={() => {
            navigate(`${path.to.salesRule(row.id)}?${params.toString()}`);
          }}
        >
          <MenuIcon icon={<LuPencil />} />
          <Trans>Edit Rule</Trans>
        </MenuItem>
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.delete}
          disabled={!permissions.can("delete", "sales")}
          destructive
          onClick={() => {
            navigate(`${path.to.deleteSalesRule(row.id)}?${params.toString()}`);
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Delete Rule</Trans>
        </MenuItem>
      </>
    ),
    [navigate, params, permissions]
  );

  return (
    <Table<(typeof rows)[number]>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "sales") && (
          <New
            label={t`Rule`}
            to={`${path.to.newSalesRule}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Sales Rules`}
    />
  );
});

SalesRulesTable.displayName = "SalesRulesTable";
export default SalesRulesTable;
