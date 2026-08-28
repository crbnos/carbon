import type { Database } from "@carbon/database";
import { Checkbox, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendarClock,
  LuPencil,
  LuShieldCheck,
  LuTrash,
  LuWrench
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import { warrantyTermStartBasisType } from "../../sales.models";

type WarrantyTerm = Database["public"]["Tables"]["warrantyTerm"]["Row"];

type WarrantyTermsTableProps = {
  data: WarrantyTerm[];
  count: number;
};

// A covered class with no duration is lifetime — the column has to say so,
// because an empty cell would otherwise read as "not covered".
const duration = (covers: boolean, months: number | null) =>
  !covers ? "—" : months === null ? "Lifetime" : `${months} months`;

const WarrantyTermsTable = memo(({ data, count }: WarrantyTermsTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const customColumns = useCustomColumns<WarrantyTerm>("warrantyTerm");
  const columns = useMemo<ColumnDef<WarrantyTerm>[]>(() => {
    const defaultColumns: ColumnDef<WarrantyTerm>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id}>
            <Enumerable value={row.original.name} />
          </Hyperlink>
        ),
        meta: { icon: <LuShieldCheck /> }
      },
      {
        accessorKey: "startBasis",
        header: t`Starts On`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "static",
            options: warrantyTermStartBasisType.map((basis) => ({
              value: basis,
              label: basis
            }))
          },
          icon: <LuCalendarClock />
        }
      },
      {
        id: "parts",
        header: t`Parts`,
        cell: ({ row }) =>
          duration(row.original.coversParts, row.original.partsDurationMonths),
        meta: { icon: <LuWrench /> }
      },
      {
        id: "labor",
        header: t`Labor`,
        cell: ({ row }) =>
          duration(row.original.coversLabor, row.original.laborDurationMonths),
        meta: { icon: <LuWrench /> }
      },
      {
        accessorKey: "coversParts",
        header: t`Covers Parts`,
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          filter: {
            type: "static",
            options: [
              { value: "true", label: t`Yes` },
              { value: "false", label: t`No` }
            ]
          },
          icon: <LuShieldCheck />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, t]);

  const renderContextMenu = useCallback(
    (row: WarrantyTerm) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.warrantyTerm(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Term</Trans>
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "sales")}
            onClick={() => {
              navigate(
                `${path.to.deleteWarrantyTerm(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Term</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<WarrantyTerm>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "sales") && (
          <New
            label={t`Warranty Term`}
            to={`${path.to.newWarrantyTerm}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Warranty Terms`}
    />
  );
});

WarrantyTermsTable.displayName = "WarrantyTermsTable";
export default WarrantyTermsTable;
