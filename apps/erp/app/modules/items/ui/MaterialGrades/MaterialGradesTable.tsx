import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBeef,
  LuCircleCheck,
  LuGlassWater,
  LuPencil,
  LuTrash,
} from "react-icons/lu";
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
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const substances = useSubstance();

    const rows = useMemo(() => data, [data]);

    const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "substanceName",
          header: "Substance",
          cell: ({ row }) => <Enumerable value={row.original.substanceName} />,
          meta: {
            icon: <LuGlassWater />,
            filter: {
              type: "static",
              options: substances.map((substance) => ({
                label: <Enumerable value={substance.label} />,
                value: substance.value,
              })),
            },
          },
        },
        {
          accessorKey: "name",
          header: "Grade",
          cell: ({ row }) =>
            row.original.companyId === null ? (
              <Enumerable value={row.original.name} />
            ) : (
              <Hyperlink
                to={`${path.to.materialGrade(
                  row.original.id!
                )}?${params.toString()}`}
              >
                <Enumerable value={row.original.name} />
              </Hyperlink>
            ),
          meta: {
            icon: <LuBeef />,
          },
        },

        {
          accessorKey: "companyId",
          header: "Standard",
          cell: ({ row }) => {
            return row.original.companyId === null ? (
              <Badge variant="outline">Standard</Badge>
            ) : (
              <Badge variant="blue">Custom</Badge>
            );
          },
          meta: {
            icon: <LuCircleCheck />,
          },
        },
      ];
      return [...defaultColumns];
    }, [params, substances]);

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
              Edit Material Grade
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
              Delete Material Grade
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
        primaryAction={
          permissions.can("create", "parts") && (
            <New
              label="Material Grade"
              to={`${path.to.newMaterialGrade}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Material Grades"
      />
    );
  }
);

MaterialGradesTable.displayName = "MaterialGradesTable";
export default MaterialGradesTable;
