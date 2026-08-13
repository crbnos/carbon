import { Badge, Copy, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCircleCheck,
  LuDessert,
  LuKeySquare,
  LuPencil,
  LuShapes,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useShape } from "~/components/Form/Shape";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { MaterialDimension } from "../../types";

type MaterialDimensionsTableProps = {
  data: MaterialDimension[];
  count: number;
};

const MaterialDimensionsTable = memo(
  ({ data, count }: MaterialDimensionsTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const shapes = useShape();

    const rows = useMemo(() => data, [data]);

    const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "formName",
          header: t`Shape`,
          cell: ({ row }) => <Enumerable value={row.original.formName} />,
          meta: {
            icon: <LuShapes />,
            filter: {
              type: "static",
              options: shapes.map((shape) => ({
                label: <Enumerable value={shape.label} />,
                value: shape.label
              }))
            }
          }
        },
        {
          accessorKey: "name",
          header: t`Dimension`,
          cell: ({ row }) =>
            row.original.companyId === null ? (
              row.original.name
            ) : (
              <Hyperlink
                to={`${path.to.materialDimension(
                  row.original.id!
                )}?${params.toString()}`}
              >
                {row.original.name}
              </Hyperlink>
            ),
          meta: {
            icon: <LuDessert />
          }
        },
        {
          accessorKey: "id",
          header: t`ID`,
          cell: ({ row }) => (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{row.original.id}</span>
              <Copy text={row.original.id!} />
            </div>
          ),
          meta: {
            icon: <LuKeySquare />
          }
        },
        {
          accessorKey: "companyId",
          header: t`Standard`,
          cell: ({ row }) => {
            return row.original.companyId === null ? (
              <Badge variant="outline">
                <Trans>Standard</Trans>
              </Badge>
            ) : (
              <Badge variant="blue">
                <Trans>Custom</Trans>
              </Badge>
            );
          },
          meta: {
            icon: <LuCircleCheck />
          }
        }
      ];
      return [...defaultColumns];
    }, [params, shapes, t]);

    const renderContextMenu = useCallback(
      (row: (typeof rows)[number]) => {
        return (
          <>
            <MenuItem
              disabled={
                !permissions.can("update", "parts") || row.companyId === null
              }
              onClick={() => {
                navigate(
                  `${path.to.materialDimension(row.id!)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Material Dimension</Trans>
            </MenuItem>
            <MenuItem
              disabled={
                !permissions.can("delete", "parts") || row.companyId === null
              }
              destructive
              onClick={() => {
                navigate(
                  `${path.to.deleteMaterialDimension(
                    row.id!
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Material Dimension</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<(typeof rows)[number]>
        data={data}
        columns={columns}
        count={count}
        importCSV={[
          {
            table: "materialDimension" as const,
            label: t`Material Dimensions`
          }
        ]}
        primaryAction={
          permissions.can("create", "parts") && (
            <New
              label={t`Material Dimension`}
              to={`${path.to.newMaterialDimension}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Material Dimensions`}
      />
    );
  }
);

MaterialDimensionsTable.displayName = "MaterialDimensionsTable";
export default MaterialDimensionsTable;
