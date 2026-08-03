import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuArrowRight,
  LuHash,
  LuMaximize,
  LuPackage,
  LuPencil,
  LuStepForward,
  LuText,
  LuTextCursor,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import type { ItemSerialSequence } from "~/modules/settings";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";

type ItemSerialSequencesTableProps = {
  data: ItemSerialSequence[];
  count: number;
};

const ItemSerialSequencesTable = memo(
  ({ data, count }: ItemSerialSequencesTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [items] = useItems();

    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
      return [
        {
          accessorKey: "itemReadableId",
          header: t`Item`,
          cell: ({ row }) => (
            <Hyperlink to={row.original.id ?? ""}>
              {row.original.itemReadableId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuPackage />,
            filter: {
              type: "static",
              options: items?.map((item) => ({
                value: item.readableIdWithRevision,
                label: item.readableIdWithRevision
              }))
            }
          }
        },
        {
          accessorKey: "itemName",
          header: t`Name`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuText />
          }
        },
        {
          accessorKey: "prefix",
          header: t`Prefix`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuTextCursor />
          }
        },
        {
          accessorKey: "next",
          header: t`Current`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuArrowRight />
          }
        },
        {
          accessorKey: "size",
          header: t`Size`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuMaximize />
          }
        },
        {
          accessorKey: "step",
          header: t`Step`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuStepForward />
          }
        },
        {
          accessorKey: "suffix",
          header: t`Suffix`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuHash />
          }
        }
      ];
    }, [items, t]);

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "settings")}
              onClick={() => {
                navigate(
                  `${path.to.serialNumberSequence(row.id ?? "")}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit</Trans>
            </MenuItem>
            <MenuItem
              disabled={!permissions.can("delete", "settings")}
              onClick={() => {
                navigate(
                  `${path.to.deleteSerialNumberSequence(row.id ?? "")}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<(typeof data)[number]>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "settings") && (
            <New
              label={t`Serial Number`}
              to={path.to.newSerialNumberSequence}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Serial Numbers`}
      />
    );
  }
);

ItemSerialSequencesTable.displayName = "ItemSerialSequencesTable";
export default ItemSerialSequencesTable;
