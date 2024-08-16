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
import { EditableText } from "~/components/Editable";
import Grid from "~/components/Grid";
import type { CustomerPart } from "~/modules/items";
import useCustomerParts from "./useCustomerParts";

type CustomerPartsProps = {
  customerParts: CustomerPart[];
};

const CustomerParts = ({ customerParts }: CustomerPartsProps) => {
  const navigate = useNavigate();
  const { canEdit, onCellEdit } = useCustomerParts();

  const columns = useMemo<ColumnDef<CustomerPart>[]>(() => {
    const defaultColumns: ColumnDef<CustomerPart>[] = [
      {
        accessorKey: "customer.id",
        header: "Customer",
        cell: ({ row }) => (
          <HStack className="justify-between">
            {/* @ts-ignore */}
            <span>{row.original.customer.name}</span>
          </HStack>
        ),
      },
      {
        accessorKey: "customerPartId",
        header: "Customer ID",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "customerPartRevision",
        header: "Customer Revision",
        cell: (item) => item.getValue(),
      },
    ];
    return [...defaultColumns];
  }, []);

  const editableComponents = useMemo(
    () => ({
      customerPartId: EditableText(onCellEdit),
      customerPartRevision: EditableText(onCellEdit),
    }),
    [onCellEdit]
  );

  return (
    <>
      <Card className="w-full h-full min-h-[50vh]">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Customer Parts</CardTitle>
          </CardHeader>
          <CardAction>{canEdit && <New to="new" />}</CardAction>
        </HStack>
        <CardContent>
          <Grid<CustomerPart>
            data={customerParts}
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

export default CustomerParts;
