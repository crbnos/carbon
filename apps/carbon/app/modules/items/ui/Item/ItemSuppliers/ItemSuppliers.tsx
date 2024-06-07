import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import { Outlet, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { New } from "~/components";
import {
  EditableList,
  EditableNumber,
  EditableText,
} from "~/components/Editable";
import Grid from "~/components/Grid";
import { useRouteData } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { ItemSupplier, UnitOfMeasureListItem } from "~/modules/items";
import { path } from "~/utils/path";
import useItemSuppliers from "./useItemSuppliers";

type ItemSuppliersProps = {
  suppliers: ItemSupplier[];
};

// TODO: make dynamic
const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const ItemSuppliers = ({ suppliers }: ItemSuppliersProps) => {
  const navigate = useNavigate();
  const { canEdit, onCellEdit } = useItemSuppliers();
  const sharedPartData = useRouteData<{
    unitOfMeasures: UnitOfMeasureListItem[];
  }>(path.to.partRoot);

  const unitOfMeasureOptions = useMemo(() => {
    return (
      sharedPartData?.unitOfMeasures.map((unitOfMeasure) => ({
        label: unitOfMeasure.code,
        value: unitOfMeasure.code,
      })) ?? []
    );
  }, [sharedPartData?.unitOfMeasures]);

  const customColumns = useCustomColumns<ItemSupplier>("itemSupplier");

  const columns = useMemo<ColumnDef<ItemSupplier>[]>(() => {
    const defaultColumns: ColumnDef<ItemSupplier>[] = [
      {
        accessorKey: "supplier.id",
        header: "Supplier",
        cell: ({ row }) => (
          <HStack className="justify-between">
            {/* @ts-ignore */}
            <span>{row.original.supplier.name}</span>
            {/* {canEdit && (
              <div className="relative w-6 h-5">
                <Button
                  asChild
                  isIcon
                  variant="ghost"
                  className="absolute right-[-3px] top-[-3px] outline-none border-none active:outline-none focus-visible:outline-none"
                  aria-label="Edit part supplier"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link to={`${row.original.id}`}>
                    <MdMoreHoriz />
                  </Link>
                </Button>
              </div>
            )} */}
          </HStack>
        ),
      },
      {
        accessorKey: "supplierPartId",
        header: "Supplier ID",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "unitPrice",
        header: "Unit Price",
        cell: (item) => formatter.format(item.getValue<number>()),
      },
      {
        accessorKey: "supplierUnitOfMeasureCode",
        header: "Unit of Measure",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "minimumOrderQuantity",
        header: "Minimum Order Quantity",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "conversionFactor",
        header: "Conversion Factor",
        cell: (item) => item.getValue(),
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns]);

  const editableComponents = useMemo(
    () => ({
      supplierPartId: EditableText(onCellEdit),
      supplierUnitOfMeasureCode: EditableList(onCellEdit, unitOfMeasureOptions),
      minimumOrderQuantity: EditableNumber(onCellEdit),
      conversionFactor: EditableNumber(onCellEdit),
      unitPrice: EditableNumber(onCellEdit),
    }),
    [onCellEdit, unitOfMeasureOptions]
  );

  return (
    <>
      <Card className="w-full h-full min-h-[50vh]">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Suppliers</CardTitle>
          </CardHeader>
          <CardAction>{canEdit && <New to="new" />}</CardAction>
        </HStack>
        <CardContent>
          <Grid<ItemSupplier>
            data={suppliers}
            columns={columns}
            canEdit={canEdit}
            editableComponents={editableComponents}
            onNewRow={canEdit ? () => navigate("new") : undefined}
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default ItemSuppliers;
