import { Badge, Copy, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCircleCheck,
  LuCode,
  LuKeySquare,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { Substance } from "../../types";

type MaterialSubstancesTableProps = {
  data: Substance[];
  count: number;
};

const MaterialSubstancesTable = memo(
  ({ data, count }: MaterialSubstancesTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const rows = useMemo(() => data, [data]);
    const customColumns = useCustomColumns<Substance>("materialSubstance");

    const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) =>
            row.original.companyId === null ? (
              <Enumerable value={row.original.name} />
            ) : (
              <Hyperlink
                to={`${path.to.materialSubstance(
                  row.original.id
                )}?${params.toString()}`}
              >
                <Enumerable value={row.original.name} />
              </Hyperlink>
            ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "code",
          header: t`Code`,
          cell: ({ row }) => row.original.code,
          meta: {
            icon: <LuCode />
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
      return [...defaultColumns, ...customColumns];
    }, [params, customColumns, t]);

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
                  `${path.to.materialSubstance(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Substance</Trans>
            </MenuItem>
            <MenuItem
              disabled={
                !permissions.can("delete", "parts") || row.companyId === null
              }
              destructive
              onClick={() => {
                navigate(
                  `${path.to.deleteMaterialSubstance(
                    row.id
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Substance</Trans>
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
            table: "materialSubstance" as const,
            label: t`Material Substances`
          }
        ]}
        primaryAction={
          permissions.can("create", "parts") && (
            <New
              label={t`Material Substance`}
              to={`${path.to.newMaterialSubstance}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Material Substances`}
      />
    );
  }
);

MaterialSubstancesTable.displayName = "MaterialSubstancesTable";
export default MaterialSubstancesTable;
