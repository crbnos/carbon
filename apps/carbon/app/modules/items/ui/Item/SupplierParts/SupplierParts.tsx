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
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import Grid from "~/components/Grid";
import { useCurrencyFormatter } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { SupplierPart } from "~/modules/items";
import useSupplierParts from "./useSupplierParts";

type SupplierPartsProps = {
  supplierParts: SupplierPart[];
};

const SupplierParts = ({ supplierParts }: SupplierPartsProps) => {
  const navigate = useNavigate();
  const { canEdit, onCellEdit } = useSupplierParts();

  const formatter = useCurrencyFormatter();
  const unitOfMeasureOptions = useUnitOfMeasure();
  const customColumns = useCustomColumns<SupplierPart>("supplierPart");

  const columns = useMemo<ColumnDef<SupplierPart>[]>(() => {
    const defaultColumns: ColumnDef<SupplierPart>[] = [
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
  }, [customColumns, formatter]);

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
            <CardTitle>Supplier Parts</CardTitle>
          </CardHeader>
          <CardAction>{canEdit && <New to="new" />}</CardAction>
        </HStack>
        <CardContent>
          <Grid<SupplierPart>
            data={supplierParts}
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

export default SupplierParts;
