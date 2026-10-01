// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  IconButton
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { LuEllipsisVertical, LuPencil, LuTrash } from "react-icons/lu";
import { Outlet, useNavigate } from "react-router";
import { CustomerAvatar, New } from "~/components";
import { EditableText } from "~/components/Editable";
import Grid from "~/components/Grid";
import { path } from "~/utils/path";
import type { CustomerPart } from "../../../types";
import useCustomerParts from "./useCustomerParts";

type CustomerPartsProps = {
  customerParts: CustomerPart[];
  itemId: string;
};

const CustomerParts = ({ customerParts, itemId }: CustomerPartsProps) => {
  const navigate = useNavigate();
  const { t } = useLingui();
  const { canEdit, onCellEdit, canDelete } = useCustomerParts();

  const columns = useMemo<ColumnDef<CustomerPart>[]>(() => {
    const defaultColumns: ColumnDef<CustomerPart>[] = [
      {
        accessorKey: "customer.id",
        header: t`Customer`,
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[100px]">
            <CustomerAvatar customerId={row.original.customerId} />
            <div className="relative w-6 h-5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label={t`Edit purchase order line type`}
                    icon={<LuEllipsisVertical />}
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
                    destructive
                    disabled={!canDelete}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    Delete Customer Part
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </HStack>
        )
      },
      {
        accessorKey: "customerPartId",
        header: t`Customer ID`,
        cell: (item) => item.getValue()
      },
      {
        accessorKey: "customerPartRevision",
        header: t`Customer Revision`,
        cell: (item) => item.getValue()
      }
    ];
    return [...defaultColumns];
  }, [canDelete, canEdit, itemId, navigate, t]);

  const editableComponents = useMemo(
    () => ({
      customerPartId: EditableText(onCellEdit),
      customerPartRevision: EditableText(onCellEdit)
    }),
    [onCellEdit]
  );

  return (
    <>
      <Card className="w-full">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Customer Parts</Trans>
            </CardTitle>
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
