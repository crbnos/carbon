import type { Json } from "@carbon/database";
import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuPencil, LuTag, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";

type StorageType = {
  id: string;
  name: string;
  companyId: string;
  customFields: Json;
};

type StorageTypesTableProps = {
  data: StorageType[];
  count: number;
};

const StorageTypesTable = memo(({ data, count }: StorageTypesTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const customColumns = useCustomColumns<StorageType>("storageType");

  const rows = useMemo(() => data, [data]);

  const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
    const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink
            to={`${path.to.storageType(row.original.id)}?${params.toString()}`}
          >
            <Enumerable value={row.original.name} />
          </Hyperlink>
        ),
        meta: { icon: <LuTag /> }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, params, t]);

  const renderContextMenu = useCallback(
    (row: (typeof rows)[number]) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "parts")}
            onClick={() => {
              navigate(`${path.to.storageType(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Storage Type</Trans>
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "parts")}
            destructive
            onClick={() => {
              navigate(
                `${path.to.deleteStorageType(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Storage Type</Trans>
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
          table: "storageType" as const,
          label: t`Storage Types`
        }
      ]}
      primaryAction={
        permissions.can("create", "parts") && (
          <New
            label={t`Storage Type`}
            to={`${path.to.newStorageType}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Storage Types`}
    />
  );
});

StorageTypesTable.displayName = "StorageTypesTable";
export default StorageTypesTable;
