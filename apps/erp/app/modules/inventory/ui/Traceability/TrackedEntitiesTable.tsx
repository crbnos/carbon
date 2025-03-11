import { MenuIcon, MenuItem } from "@carbon/react";
import { useNumberFormatter } from "@react-aria/i18n";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCheck,
  LuFile,
  LuHash,
  LuNetwork,
} from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import { usePermissions } from "~/hooks";
import { trackedEntityStatus, type TrackedEntity } from "~/modules/inventory";
import { path } from "~/utils/path";
import TrackedEntityStatus from "./TrackedEntityStatus";
import type { Item } from "~/stores/items";
import { useItems } from "~/stores/items";
import { Enumerable } from "~/components/Enumerable";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";

type TrackedEntitiesTableProps = {
  data: TrackedEntity[];
  count: number;
};

const TrackedEntitiesTable = memo(
  ({ data, count }: TrackedEntitiesTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const numberFormatter = useNumberFormatter();
    const [items] = useItems();

    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(
      () => [
        {
          accessorKey: "sourceDocumentId",
          header: "Entity",
          cell: ({ row }) => (
            <Hyperlink
              to={`${path.to.traceabilityGraph}?trackedEntityId=${row.original.id}`}
            >
              <div className="flex flex-col items-start gap-0">
                <span>{row.original.sourceDocumentReadableId}</span>
                <span className="text-xs text-muted-foreground">
                  {row.original.id}
                </span>
              </div>
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />,

            filter: {
              type: "static",
              options: items.map((i) => ({
                label: i.readableId,
                value: i.id,
              })),
            },
          },
        },
        {
          accessorKey: "quantity",
          header: "Quantity",
          cell: ({ row }) => (
            <span>{numberFormatter.format(row.original.quantity)}</span>
          ),
          meta: {
            icon: <LuHash />,
          },
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: ({ row }) => (
            <TrackedEntityStatus status={row.original.status} />
          ),
          meta: {
            icon: <LuCheck />,
            filter: {
              type: "static",
              options: trackedEntityStatus
                .filter((v) => v !== "Reserved")
                .map((v) => ({
                  label: <TrackedEntityStatus status={v} />,
                  value: v,
                })),
            },
          },
        },
        {
          accessorKey: "sourceDocument",
          header: "Source Document",
          cell: ({ row }) => (
            <SourceDocumentLink data={row.original} items={items} />
          ),
          meta: {
            icon: <LuFile />,
          },
        },
      ],
      [numberFormatter, items]
    );

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "inventory")}
              onClick={() => {
                navigate(
                  `${path.to.traceabilityGraph}?trackedEntityId=${row.id}`
                );
              }}
            >
              <MenuIcon icon={<LuNetwork />} />
              View Traceability Graph
            </MenuItem>
          </>
        );
      },
      [navigate, permissions]
    );

    return (
      <Table<(typeof data)[number]>
        data={data}
        columns={columns}
        count={count}
        renderContextMenu={renderContextMenu}
        title="Tracked Entities"
      />
    );
  }
);

function SourceDocumentLink({
  data,
  items,
}: {
  data: TrackedEntity;
  items: Item[];
}) {
  switch (data.sourceDocument) {
    case "Item":
      const item = items.find((item) => item.id === data.sourceDocumentId);
      if (!item) return <Enumerable value={data.sourceDocument} />;
      return (
        // @ts-ignore
        <Hyperlink to={getLinkToItemDetails(item.type, item.id)}>
          <Enumerable value={data.sourceDocument} />
        </Hyperlink>
      );
    default:
      return <Enumerable value={data.sourceDocument} />;
  }
}

TrackedEntitiesTable.displayName = "TrackedEntitiesTable";
export default TrackedEntitiesTable;
