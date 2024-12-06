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
import { Outlet, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { LuMoreVertical, LuPencil, LuTrash } from "react-icons/lu";
import { CustomerAvatar, New } from "~/components";
import { EditableText } from "~/components/Editable";
import Grid from "~/components/Grid";
import type { CustomerPart } from "~/modules/items";
import { path } from "~/utils/path";
import useCustomerParts from "./useCustomerParts";

type CustomerPartsProps = {
  customerParts: CustomerPart[];
  itemId: string;
};

const CustomerParts = ({ customerParts, itemId }: CustomerPartsProps) => {
  const navigate = useNavigate();
  const { canEdit, onCellEdit, canDelete } = useCustomerParts();

  const columns = useMemo<ColumnDef<CustomerPart>[]>(() => {
    const defaultColumns: ColumnDef<CustomerPart>[] = [
      {
        accessorKey: "customer.id",
        header: "Customer",
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[100px]">
            <CustomerAvatar customerId={row.original.customerId} />
            <div className="relative w-6 h-5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label="Edit purchase order line type"
                    icon={<LuMoreVertical />}
                    size="md"
                    className="absolute right-[-1px] top-[-6px]"
                    variant="ghost"
                    onClick={(e) => e.stopPropagation()}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() =>
                      navigate(path.to.customerPart(itemId, row.original.id!))
                    }
                    disabled={!canEdit}
                  >
                    <DropdownMenuIcon icon={<LuPencil />} />
                    Edit Customer Part
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      navigate(
                        path.to.deleteCustomerPart(itemId, row.original.id!)
                      )
                    }
                    disabled={!canDelete}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    Delete Customer Part
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
  }, [canDelete, canEdit, itemId, navigate]);

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
          <CardAction>
            {canEdit && <New to={path.to.newCustomerPart(itemId)} />}
          </CardAction>
        </HStack>
        <CardContent>
          <Grid<CustomerPart>
            data={customerParts}
            columns={columns}
            canEdit={canEdit}
            editableComponents={editableComponents}
            onNewRow={
              canEdit
                ? () => navigate(path.to.newCustomerPart(itemId))
                : undefined
            }
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default CustomerParts;
