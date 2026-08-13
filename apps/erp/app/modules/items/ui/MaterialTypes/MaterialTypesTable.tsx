import { Badge, Copy, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCircleCheck,
  LuGlassWater,
  LuKeySquare,
  LuPencil,
  LuShapes,
  LuTag,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useShape } from "~/components/Form/Shape";
import { useSubstance } from "~/components/Form/Substance";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { MaterialType } from "../../types";

type MaterialTypesTableProps = {
  data: MaterialType[];
  count: number;
};

const MaterialTypesTable = memo(({ data, count }: MaterialTypesTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const substances = useSubstance();
  const shapes = useShape();

  const rows = useMemo(() => data, [data]);

  const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
    const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
      {
        accessorKey: "substanceName",
        header: t`Substance`,
        cell: ({ row }) => <Enumerable value={row.original.substanceName} />,
        meta: {
          icon: <LuGlassWater />,
          filter: {
            type: "static",
            options: substances.map((substance) => ({
              label: <Enumerable value={substance.label} />,
              value: substance.label
            }))
          }
        }
      },
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
        header: t`Type`,
        cell: ({ row }) =>
          row.original.companyId === null ? (
            row.original.name
          ) : (
            <Hyperlink
              to={`${path.to.materialType(
                row.original.id!
              )}?${params.toString()}`}
            >
              {row.original.name}
            </Hyperlink>
          ),
        meta: {
          icon: <LuTag />
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
  }, [params, substances, shapes, t]);

  const renderContextMenu = useCallback(
    (row: (typeof rows)[number]) => {
      return (
        <>
          <MenuItem
            disabled={
              !permissions.can("update", "parts") || row.companyId === null
            }
            onClick={() => {
              navigate(`${path.to.materialType(row.id!)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Material Type</Trans>
          </MenuItem>
          <MenuItem
            disabled={
              !permissions.can("delete", "parts") || row.companyId === null
            }
            destructive
            onClick={() => {
              navigate(
                `${path.to.deleteMaterialType(row.id!)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Material Type</Trans>
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
          table: "materialType" as const,
          label: t`Material Types`
        }
      ]}
      primaryAction={
        permissions.can("create", "parts") && (
          <New
            label={t`Material Type`}
            to={`${path.to.newMaterialType}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Material Types`}
    />
  );
});

MaterialTypesTable.displayName = "MaterialTypesTable";
export default MaterialTypesTable;
