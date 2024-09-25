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
  EditableList,
  EditableNumber,
  EditablePurchaseOrderLineNumber,
  EditableText,
} from "~/components/Editable";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import Grid from "~/components/Grid";
import { useRealtime, useRouteData, useUser } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { PurchaseOrder, PurchaseOrderLine } from "~/modules/purchasing";
import { usePurchaseOrderTotals } from "~/modules/purchasing";
import { useItems } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import usePurchaseOrderLines from "./usePurchaseOrderLines";

const PurchaseOrderLines = () => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  useRealtime("purchaseOrderLine", `purchaseOrderId=eq.${orderId}`);

  const navigate = useNavigate();

  const sharedPurchasingData = useRouteData<{
    locations: ListItem[];
    shelves: ListItem[];
  }>(path.to.purchaseOrderRoot);

  const routeData = useRouteData<{
    purchaseOrder: PurchaseOrder;
    purchaseOrderLines: PurchaseOrderLine[];
  }>(path.to.purchaseOrder(orderId));

  const { defaults, id: userId } = useUser();
  const unitOfMeasureOptions = useUnitOfMeasure();

  const { canEdit, canDelete, carbon, accountOptions, onCellEdit } =
    usePurchaseOrderLines();
  const [, setPurchaseOrderTotals] = usePurchaseOrderTotals();

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.purchaseOrder?.status ?? ""
  );

  const customColumns =
    useCustomColumns<PurchaseOrderLine>("purchaseOrderLine");

  const columns = useMemo<ColumnDef<PurchaseOrderLine>[]>(() => {
    const defaultColumns: ColumnDef<PurchaseOrderLine>[] = [
      {
        header: "Line",
        cell: ({ row }) => row.index + 1,
      },
      {
        accessorKey: "purchaseOrderLineType",
        header: "Type",
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[100px]">
            <span>{row.original.purchaseOrderLineType}</span>
            <div className="relative w-6 h-5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label="Edit purchase order line type"
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
          switch (row.original.purchaseOrderLineType) {
            case "Part":
            case "Service":
            case "Material":
            case "Tool":
            case "Fixture":
            case "Consumable":
              return <span>{row.original.itemReadableId}</span>;
            case "G/L Account":
              return <span>{row.original.accountNumber}</span>;
            case "Fixed Asset":
              return <span>{row.original.assetId}</span>;
            default:
              return null;
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
        accessorKey: "purchaseQuantity",
        header: "Quantity",
        cell: ({ row }) => {
          switch (row.original.purchaseOrderLineType) {
            case "Comment":
              return null;
            default:
              return <span>{row.original.purchaseQuantity}</span>;
          }
        },
      },
      {
        accessorKey: "unitPrice",
        header: "Unit Price",
        cell: ({ row }) => {
          switch (row.original.purchaseOrderLineType) {
            case "Comment":
              return null;
            default:
              return <span>{row.original.unitPrice}</span>;
          }
        },
      },
      {
        accessorKey: "purchaseUnitOfMeasureCode",
        header: "Pur. UoM",
        cell: ({ row }) => {
          switch (row.original.purchaseOrderLineType) {
            case "Service":
            case "Comment":
            case "G/L Account":
            case "Fixed Asset":
              return null;
            default:
              return <span>{row.original.purchaseUnitOfMeasureCode}</span>;
          }
        },
      },
      {
        accessorKey: "conversionFactor",
        header: "Conversion Factor",
        cell: ({ row }) => {
          switch (row.original.purchaseOrderLineType) {
            case "Service":
            case "Comment":
            case "G/L Account":
            case "Fixed Asset":
              return null;
            default:
              return <span>{row.original.conversionFactor}</span>;
          }
        },
      },
      {
        accessorKey: "locationId",
        header: "Location",
        cell: ({ row }) => {
          switch (row.original.purchaseOrderLineType) {
            case "Part":
            case "Material":
            case "Tool":
            case "Fixture":
            case "Consumable":
              return (
                <span>
                  {
                    sharedPurchasingData?.locations?.find(
                      (l) => l.id == row.original.locationId
                    )?.name
                  }
                </span>
              );
            default:
              return null;
          }
        },
      },
      {
        accessorKey: "shelfId",
        header: "Shelf",
        cell: ({ row }) => {
          switch (row.original.purchaseOrderLineType) {
            case "Comment":
              return null;
            default:
              return (
                <span>
                  {
                    sharedPurchasingData?.shelves?.find(
                      (s) => s.id === row.original.shelfId
                    )?.name
                  }
                </span>
              );
          }
        },
      },
      {
        id: "totalPrice",
        header: "Total Price",
        cell: ({ row }) => {
          switch (row.original.purchaseOrderLineType) {
            case "Comment":
              return null;
            default:
              if (!row.original.unitPrice || !row.original.purchaseQuantity)
                return 0;
              return (
                row.original.unitPrice * row.original.purchaseQuantity
              ).toFixed(2);
          }
        },
      },
      {
        id: "quantityReceived",
        header: "Quantity Received",
        cell: ({ row }) => {
          switch (row.original.purchaseOrderLineType) {
            case "Comment":
              return null;
            default:
              return <span>{row.original.quantityReceived}</span>;
          }
        },
      },
      {
        id: "quantityInvoiced",
        header: "Quantity Invoiced",
        cell: ({ row }) => {
          switch (row.original.purchaseOrderLineType) {
            case "Comment":
              return null;
            default:
              return <span>{row.original.quantityInvoiced}</span>;
          }
        },
      },
      {
        id: "receivedComplete",
        header: "Received Complete",
        cell: ({ row }) => {
          switch (row.original.purchaseOrderLineType) {
            case "Comment":
              return null;
            default:
              return <Checkbox isChecked={!!row.original.receivedComplete} />;
          }
        },
      },
      {
        id: "invoicedComplete",
        header: "Invoiced Complete",
        cell: ({ row }) => {
          switch (row.original.purchaseOrderLineType) {
            case "Comment":
              return null;
            default:
              return <Checkbox isChecked={!!row.original.invoicedComplete} />;
          }
        },
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [
    customColumns,
    isEditable,
    canEdit,
    canDelete,
    navigate,
    sharedPurchasingData?.locations,
    sharedPurchasingData?.shelves,
  ]);

  const [items] = useItems();

  const editableComponents = useMemo(
    () => ({
      description: EditableText(onCellEdit),
      purchaseQuantity: EditableNumber(onCellEdit),
      unitPrice: EditableNumber(onCellEdit),
      itemId: EditablePurchaseOrderLineNumber(onCellEdit, {
        client: carbon,
        items: items,
        accounts: accountOptions,
        defaultLocationId: defaults.locationId,
        supplierId: routeData?.purchaseOrder.supplierId ?? "",
        userId: userId,
      }),
      purchaseUnitOfMeasureCode: EditableList(onCellEdit, unitOfMeasureOptions),
      conversionFactor: EditableNumber(onCellEdit),
    }),
    [
      onCellEdit,
      carbon,
      items,
      accountOptions,
      defaults.locationId,
      routeData?.purchaseOrder.supplierId,
      userId,
      unitOfMeasureOptions,
    ]
  );

  return (
    <>
      <Card className="w-full h-full min-h-[50vh]">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Purchase Order Lines</CardTitle>
          </CardHeader>
          <CardAction>{canEdit && isEditable && <New to="new" />}</CardAction>
        </HStack>

        <CardContent>
          <Grid<PurchaseOrderLine>
            data={routeData?.purchaseOrderLines ?? []}
            columns={columns}
            canEdit={canEdit && isEditable}
            editableComponents={editableComponents}
            onDataChange={(lines: PurchaseOrderLine[]) => {
              const totals = lines.reduce(
                (acc, line) => {
                  acc.total +=
                    (line.purchaseQuantity ?? 0) * (line.unitPrice ?? 0);

                  return acc;
                },
                { total: 0 }
              );
              setPurchaseOrderTotals(totals);
            }}
            onNewRow={canEdit && isEditable ? () => navigate("new") : undefined}
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default PurchaseOrderLines;
