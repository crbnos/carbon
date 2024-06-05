import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
} from "@carbon/react";
import { Outlet, useNavigate, useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { MdMoreHoriz } from "react-icons/md";
import { New } from "~/components";
import {
  EditableNumber,
  EditableSalesOrderLineNumber,
  EditableText,
} from "~/components/Editable";
import Grid from "~/components/Grid";
import { useRealtime, useRouteData, useUser } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { SalesOrder, SalesOrderLine } from "~/modules/sales";
import { useSalesOrderTotals } from "~/modules/sales";
import { useItems } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import useSalesOrderLines from "./useSalesOrderLines";

const SalesOrderLines = () => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  useRealtime("salesOrderLine", `salesOrderId=eq.${orderId}`);

  const navigate = useNavigate();

  const routeData = useRouteData<{
    salesOrderLines: SalesOrderLine[];
    locations: ListItem[];
    salesOrder: SalesOrder;
  }>(path.to.salesOrder(orderId));

  const locations = routeData?.locations ?? [];
  const { defaults, id: userId } = useUser();
  const { canEdit, canDelete, supabase, onCellEdit } = useSalesOrderLines();
  const [, setSalesOrderTotals] = useSalesOrderTotals();

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.salesOrder?.status ?? ""
  );

  const customColumns = useCustomColumns<SalesOrderLine>("salesOrderLine");

  const columns = useMemo<ColumnDef<SalesOrderLine>[]>(() => {
    const defaultColumns: ColumnDef<SalesOrderLine>[] = [
      {
        header: "Line",
        cell: ({ row }) => row.index + 1,
      },
      {
        accessorKey: "salesOrderLineType",
        header: "Type",
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[100px]">
            <span>{row.original.salesOrderLineType}</span>
            <div className="relative w-6 h-5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label="Edit sales order line type"
                    icon={<MdMoreHoriz />}
                    size="md"
                    className="absolute right-[-1px] top-[-6px]"
                    variant="ghost"
                    onClick={(e) => e.stopPropagation()}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => navigate(row.original.id!)}
                    disabled={!isEditable || !canEdit}
                  >
                    <DropdownMenuIcon icon={<LuPencil />} />
                    Edit Line
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => navigate(`delete/${row.original.id}`)}
                    disabled={!isEditable || !canDelete}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    Delete Line
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </HStack>
        ),
      },
      {
        accessorKey: "itemId",
        header: "Number",
        cell: ({ row }) => {
          switch (row.original.salesOrderLineType) {
            case "Comment":
              return null;
            default:
              return <span>{row.original.itemId}</span>;
          }
        },
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => {
          let description = row.original.description ?? "";
          if (description.length > 50) {
            description = description.substring(0, 50) + "...";
          }
          return <span>{description}</span>;
        },
      },
      {
        accessorKey: "saleQuantity",
        header: "Quantity",
        cell: ({ row }) => {
          switch (row.original.salesOrderLineType) {
            case "Comment":
              return null;
            default:
              return <span>{row.original.saleQuantity}</span>;
          }
        },
      },
      {
        accessorKey: "unitPrice",
        header: "Unit Price",
        cell: ({ row }) => {
          switch (row.original.salesOrderLineType) {
            case "Comment":
              return null;
            default:
              return <span>{row.original.unitPrice}</span>;
          }
        },
      },
      {
        accessorKey: "locationId",
        header: "Location",
        cell: ({ row }) => {
          switch (row.original.salesOrderLineType) {
            case "Part":
              return (
                <span>
                  {locations.find((l) => l.id == row.original.locationId)?.name}
                </span>
              );
          }
        },
      },
      {
        accessorKey: "shelfId",
        header: "Shelf",
        cell: ({ row }) => {
          switch (row.original.salesOrderLineType) {
            case "Comment":
              return null;
            default:
              return <span>{row.original.shelfId}</span>;
          }
        },
      },
      {
        id: "totalPrice",
        header: "Total Price",
        cell: ({ row }) => {
          switch (row.original.salesOrderLineType) {
            case "Comment":
              return null;
            default:
              if (!row.original.unitPrice || !row.original.saleQuantity)
                return 0;
              return (
                row.original.unitPrice * row.original.saleQuantity
              ).toFixed(2);
          }
        },
      },
      {
        accessorKey: "quantitySent",
        header: "Quantity Received",
        cell: ({ row }) => {
          switch (row.original.salesOrderLineType) {
            case "Comment":
              return null;
            default:
              return <span>{row.original.quantitySent}</span>;
          }
        },
      },
      {
        accessorKey: "quantityInvoiced",
        header: "Quantity Invoiced",
        cell: ({ row }) => {
          switch (row.original.salesOrderLineType) {
            case "Comment":
              return null;
            default:
              return <span>{row.original.quantityInvoiced}</span>;
          }
        },
      },
      {
        accessorKey: "sentComplete",
        header: "Shipped Com`plete",
        cell: ({ row }) => {
          switch (row.original.salesOrderLineType) {
            case "Comment":
              return null;
            default:
              return <Checkbox isChecked={!!row.original.sentComplete} />;
          }
        },
      },
      {
        id: "invoicedComplete",
        header: "Invoiced Complete",
        cell: ({ row }) => {
          switch (row.original.salesOrderLineType) {
            case "Comment":
              return null;
            default:
              return <Checkbox isChecked={!!row.original.invoicedComplete} />;
          }
        },
      },
    ];
    return [...defaultColumns, ...customColumns];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, customColumns]);

  const [items] = useItems();

  const editableComponents = useMemo(
    () => ({
      description: EditableText(onCellEdit),
      saleQuantity: EditableNumber(onCellEdit),
      unitPrice: EditableNumber(onCellEdit),
      itemId: EditableSalesOrderLineNumber(onCellEdit, {
        client: supabase,
        items: items,
        defaultLocationId: defaults.locationId,
        userId: userId,
      }),
    }),
    [onCellEdit, supabase, items, defaults.locationId, userId]
  );

  return (
    <>
      <Card className="w-full h-full min-h-[50vh]">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Sales Order Lines</CardTitle>
          </CardHeader>
          <CardAction>{canEdit && isEditable && <New to="new" />}</CardAction>
        </HStack>

        <CardContent>
          <Grid<SalesOrderLine>
            data={routeData?.salesOrderLines ?? []}
            columns={columns}
            canEdit={canEdit && isEditable}
            editableComponents={editableComponents}
            onDataChange={(lines: SalesOrderLine[]) => {
              const totals = lines.reduce(
                (acc, line) => {
                  acc.total += (line.saleQuantity ?? 0) * (line.unitPrice ?? 0);

                  return acc;
                },
                { total: 0 }
              );
              setSalesOrderTotals(totals);
            }}
            onNewRow={canEdit && isEditable ? () => navigate("new") : undefined}
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default SalesOrderLines;
