import type { Json } from "@carbon/database";
import { Badge, MenuIcon, MenuItem, Status } from "@carbon/react";
import type { TransactionSurface } from "@carbon/utils";
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
import SurfaceChips from "./SurfaceChips";

type ItemRuleRowView = {
  id: string;
  name: string;
  severity: "error" | "warn";
  active: boolean;
  description?: string | null;
  message: string;
  updatedAt?: string | null;
  customFields: Json;
  assignmentCount?: number;
  surfaces?: TransactionSurface[];
};

type ItemRulesTableProps = {
  data: ItemRuleRowView[];
  count: number;
};

const ItemRulesTable = memo(({ data, count }: ItemRulesTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const customColumns = useCustomColumns<ItemRuleRowView>("itemRule");

  const rows = useMemo(() => data, [data]);

  const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
    const defaults: ColumnDef<(typeof rows)[number]>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink
            to={`${path.to.itemRule(row.original.id)}?${params.toString()}`}
          >
            <Enumerable value={row.original.name} />
          </Hyperlink>
        ),
        meta: { icon: <LuShieldCheck /> }
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
          )
      },
      {
        accessorKey: "surfaces",
        header: t`Surfaces`,
        cell: ({ row }) => <SurfaceChips surfaces={row.original.surfaces} />
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
          )
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
          disabled={!permissions.can("update", "parts")}
          onClick={() => {
            navigate(`${path.to.itemRule(row.id)}?${params.toString()}`);
          }}
        >
          <MenuIcon icon={<LuPencil />} />
          <Trans>Edit Rule</Trans>
        </MenuItem>
        <MenuItem
          disabled={!permissions.can("delete", "parts")}
          destructive
          onClick={() => {
            navigate(`${path.to.deleteItemRule(row.id)}?${params.toString()}`);
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
        permissions.can("create", "parts") && (
          <New
            label={t`Rule`}
            to={`${path.to.newItemRule}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Item Rules`}
    />
  );
});

ItemRulesTable.displayName = "ItemRulesTable";
export default ItemRulesTable;
