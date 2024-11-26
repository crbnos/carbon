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
import type { BuyMethod } from "~/modules/items";
import useBuyMethods from "./useBuyMethods";

type BuyMethodsProps = {
  buyMethods: BuyMethod[];
};

const BuyMethods = ({ buyMethods }: BuyMethodsProps) => {
  const navigate = useNavigate();
  const { canEdit, onCellEdit } = useBuyMethods();

  const formatter = useCurrencyFormatter();
  const unitOfMeasureOptions = useUnitOfMeasure();
  const customColumns = useCustomColumns<BuyMethod>("buyMethod");

  const columns = useMemo<ColumnDef<BuyMethod>[]>(() => {
    const defaultColumns: ColumnDef<BuyMethod>[] = [
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
            <CardTitle>Buy Methods</CardTitle>
          </CardHeader>
          <CardAction>{canEdit && <New to="new" />}</CardAction>
        </HStack>
        <CardContent>
          <Grid<BuyMethod>
            data={buyMethods}
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

export default BuyMethods;
