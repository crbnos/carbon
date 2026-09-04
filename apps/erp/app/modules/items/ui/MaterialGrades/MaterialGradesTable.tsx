import { Badge, Copy, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBeef,
  LuCircleCheck,
  LuGlassWater,
  LuKeySquare,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useSubstance } from "~/components/Form/Substance";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { MaterialGrade } from "../../types";

type MaterialGradesTableProps = {
  data: MaterialGrade[];
  count: number;
};

const MaterialGradesTable = memo(
  ({ data, count }: MaterialGradesTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const substances = useSubstance();

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
          accessorKey: "name",
          header: t`Grade`,
          cell: ({ row }) =>
            row.original.companyId === null ? (
              row.original.name
            ) : (
              <Hyperlink
                to={`${path.to.materialGrade(
                  row.original.id!
                )}?${params.toString()}`}
              >
                {row.original.name}
              </Hyperlink>
            ),
          meta: {
            icon: <LuBeef />
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
    }, [params, substances, t]);

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
                  `${path.to.materialGrade(row.id!)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Material Grade</Trans>
            </MenuItem>
            <MenuItem
              disabled={
                !permissions.can("delete", "parts") || row.companyId === null
              }
              destructive
              onClick={() => {
                navigate(
                  `${path.to.deleteMaterialGrade(row.id!)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Material Grade</Trans>
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
            table: "materialGrade" as const,
            label: t`Material Grades`
          }
        ]}
        primaryAction={
          permissions.can("create", "parts") && (
            <New
              label={t`Material Grade`}
              to={`${path.to.newMaterialGrade}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Material Grades`}
      />
    );
  }
);

MaterialGradesTable.displayName = "MaterialGradesTable";
export default MaterialGradesTable;
