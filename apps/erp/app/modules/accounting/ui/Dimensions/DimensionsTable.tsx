import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuBoxes,
  LuPencil,
  LuShapes,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import { dimensionEntityTypes } from "../../accounting.models";
import type { Dimension } from "../../types";

type DimensionsTableProps = {
  data: Dimension[];
  count: number;
};

const DimensionsTable = memo(({ data, count }: DimensionsTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<Dimension>[]>(() => {
    const defaultColumns: ColumnDef<Dimension>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink to={`${row.original.id}?${params.toString()}`}>
            {row.original.name}
          </Hyperlink>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "entityType",
        header: t`Entity Type`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "static",
            options: dimensionEntityTypes.map((v) => ({
              label: <Enumerable value={v} />,
              value: v
            }))
          },
          icon: <LuBoxes />
        }
      },
      {
        id: "valuesCount",
        header: t`Values`,
        cell: ({ row }) => {
          if (row.original.entityType === "Custom") {
            const values =
              row.original.dimensionValue?.map((v) => v.name) ?? [];
            if (values.length === 0) return 0;

            const displayValues = values.slice(0, 3);
            const remainingCount = values.length - 3;

            return (
              <div className="max-w-[320px] truncate">
                {displayValues.join(", ")}
                {remainingCount > 0 && ` +${remainingCount}`}
              </div>
            );
          }
          return (
            <Badge variant="gray">
              <Trans>Inherited</Trans>
            </Badge>
          );
        },
        meta: {
          icon: <LuShapes />
        }
      }
    ];
    return defaultColumns;
  }, [params, t]);

  const renderContextMenu = useCallback(
    (row: Dimension) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "accounting")}
            onClick={() => {
              navigate(`${path.to.dimension(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Dimension</Trans>
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "accounting")}
            onClick={() => {
              navigate(
                `${path.to.deleteDimension(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Dimension</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<Dimension>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "accounting") && (
          <New label={t`Dimension`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Dimensions`}
    />
  );
});

DimensionsTable.displayName = "DimensionsTable";
export default DimensionsTable;
