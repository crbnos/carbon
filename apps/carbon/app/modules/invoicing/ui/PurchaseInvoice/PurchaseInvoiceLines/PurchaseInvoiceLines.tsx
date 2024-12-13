import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
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
import { LuMoreVertical, LuPencil, LuTrash } from "react-icons/lu";
import { New } from "~/components";
import {
  EditableList,
  EditableNumber,
  EditablePurchaseInvoiceLineNumber,
  EditableText,
} from "~/components/Editable";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import Grid from "~/components/Grid";
import { useRealtime, useRouteData, useUser } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "~/modules/invoicing";
import { usePurchaseInvoiceTotals } from "~/modules/invoicing";
import { useItems } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import usePurchaseInvoiceLines from "./usePurchaseInvoiceLines";

const PurchaseInvoiceLines = () => {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("invoiceId not found");

  useRealtime("purchaseInvoiceLine", `invoiceId=eq.${invoiceId}`);

  const navigate = useNavigate();

  const sharedInvoicingData = useRouteData<{
    locations: ListItem[];
    shelves: ListItem[];
  }>(path.to.purchaseInvoiceRoot);

  const routeData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
    purchaseInvoiceLines: PurchaseInvoiceLine[];
  }>(path.to.purchaseInvoice(invoiceId));

  const { defaults, id: userId } = useUser();
  const [items] = useItems();
  const unitOfMeasureOptions = useUnitOfMeasure();
  const { canEdit, canDelete, carbon, accountOptions, onCellEdit } =
    usePurchaseInvoiceLines();
  const [, setPurchaseInvoiceTotals] = usePurchaseInvoiceTotals();

  const isEditable = !routeData?.purchaseInvoice?.postingDate;

  const customColumns = useCustomColumns<PurchaseInvoiceLine>(
    "purchaseInvoiceLine"
  );

  const columns = useMemo<ColumnDef<PurchaseInvoiceLine>[]>(() => {
    const defaultColumns: ColumnDef<PurchaseInvoiceLine>[] = [
      {
        header: "Line",
        cell: ({ row }) => row.index + 1,
      },
      {
        accessorKey: "invoiceLineType",
        header: "Type",
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[100px]">
            <span>{row.original.invoiceLineType}</span>
            <div className="relative w-6 h-5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label="Edit purchase order line type"
                    icon={<LuMoreVertical />}
                    className="absolute right-[-1px] top-[-6px]"
                    variant="ghost"
                    onClick={(e) => e.stopPropagation()}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => navigate(row.original.id)}
                    disabled={!isEditable || !canEdit}
                  >
                    <DropdownMenuIcon icon={<LuPencil />} />
                    Edit Line
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => navigate(`delete/${row.original.id}`)}
                    disabled={!isEditable || !canDelete}
                    destructive
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
          switch (row.original.invoiceLineType) {
            case "Part":
            case "Service":
            case "Material":
            case "Tool":
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
        accessorKey: "quantity",
        header: "Quantity",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "unitPrice",
        header: "Unit Price",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "purchaseUnitOfMeasureCode",
        header: "Pur. UoM",
        cell: ({ row }) => {
          switch (row.original.invoiceLineType) {
            case "Comment":
            case "Service":
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
          switch (row.original.invoiceLineType) {
            case "Comment":
            case "Service":
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
          switch (row.original.invoiceLineType) {
            case "Part":
            case "Material":
            case "Tool":
            // case "Fixture":
            case "Consumable":
              return (
                <span>
                  {
                    sharedInvoicingData?.locations.find(
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
          switch (row.original.invoiceLineType) {
            case "Comment":
              return null;
            default:
              return (
                <span>
                  {
                    sharedInvoicingData?.shelves.find(
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
          if (!row.original.unitPrice || !row.original.quantity) return 0;
          return (row.original.unitPrice * row.original.quantity).toFixed(2);
        },
      },
      {
        id: "quantityReceived",
        header: "Quantity Received",
        cell: (item) => item.getValue(),
      },
      {
        id: "quantityInvoiced",
        header: "Quantity Invoiced",
        cell: (item) => item.getValue(),
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [
    customColumns,
    isEditable,
    canEdit,
    canDelete,
    navigate,
    sharedInvoicingData?.locations,
    sharedInvoicingData?.shelves,
  ]);

  const editableComponents = useMemo(
    () => ({
      description: EditableText(onCellEdit),
      quantity: EditableNumber(onCellEdit),
      unitPrice: EditableNumber(onCellEdit),
      itemId: EditablePurchaseInvoiceLineNumber(onCellEdit, {
        client: carbon,
        items: items,
        accounts: accountOptions,
        defaultLocationId: defaults.locationId,
        supplierId: routeData?.purchaseInvoice.supplierId ?? "",
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
      routeData?.purchaseInvoice.supplierId,
      userId,
      unitOfMeasureOptions,
    ]
  );

  return (
    <>
      <Card className="w-full h-full min-h-[50vh]">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Purchase Invoice Lines</CardTitle>
          </CardHeader>
          <CardAction>{canEdit && isEditable && <New to="new" />}</CardAction>
        </HStack>
        <CardContent>
          <Grid<PurchaseInvoiceLine>
            data={routeData?.purchaseInvoiceLines ?? []}
            columns={columns}
            canEdit={canEdit && isEditable}
            editableComponents={editableComponents}
            onDataChange={(lines: PurchaseInvoiceLine[]) => {
              const totals = lines.reduce(
                (acc, line) => {
                  acc.total += (line.quantity ?? 0) * (line.unitPrice ?? 0);

                  return acc;
                },
                { total: 0 }
              );
              setPurchaseInvoiceTotals(totals);
            }}
            onNewRow={canEdit && isEditable ? () => navigate("new") : undefined}
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default PurchaseInvoiceLines;
