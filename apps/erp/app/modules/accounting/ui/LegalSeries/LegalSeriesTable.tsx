import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCheck,
  LuFileText,
  LuGlobe,
  LuHash,
  LuPencil,
  LuStar,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import { legalSeriesDocumentTypes } from "../../accounting.models";
import type { LegalSeries } from "../../accounting.service";

type LegalSeriesTableProps = {
  data: LegalSeries[];
  count: number;
};

const LegalSeriesTable = memo(({ data, count }: LegalSeriesTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const customColumns = useCustomColumns<LegalSeries>("legalSeries");

  const columns = useMemo<ColumnDef<LegalSeries>[]>(() => {
    const defaultColumns: ColumnDef<LegalSeries>[] = [
      {
        accessorKey: "code",
        header: t`Code`,
        cell: ({ row }) => (
          <Hyperlink to={`${row.original.id}?${params.toString()}`}>
            <Enumerable value={row.original.code} />
          </Hyperlink>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "name",
        header: t`Name`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuHash />
        }
      },
      {
        accessorKey: "documentType",
        header: t`Document Type`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "static",
            options: legalSeriesDocumentTypes.map((v) => ({
              label: <Enumerable value={v} />,
              value: v
            }))
          },
          icon: <LuFileText />
        }
      },
      {
        accessorKey: "countryCode",
        header: t`Country`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          icon: <LuGlobe />
        }
      },
      {
        accessorKey: "prefix",
        header: t`Prefix`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuHash />
        }
      },
      {
        accessorKey: "isDefault",
        header: t`Default`,
        cell: (item) => (item.getValue() ? t`Yes` : t`No`),
        meta: {
          icon: <LuStar />
        }
      },
      {
        accessorKey: "isActive",
        header: t`Active`,
        cell: (item) => (item.getValue() ? t`Yes` : t`No`),
        meta: {
          icon: <LuCheck />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [params, customColumns, t]);

  const renderContextMenu = useCallback(
    (row: LegalSeries) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "accounting")}
            onClick={() => {
              navigate(
                `${path.to.legalSeriesById(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Legal Series</Trans>
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "accounting")}
            onClick={() => {
              navigate(
                `${path.to.deleteLegalSeries(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Legal Series</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<LegalSeries>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "accounting") && (
          <New label={t`Legal Series`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Legal Series`}
    />
  );
});

LegalSeriesTable.displayName = "LegalSeriesTable";
export default LegalSeriesTable;
