// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
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
  MENU_ITEM_SHORTCUTS,
  VStack
} from "@carbon/react";
import { distinctItemText } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { LuEllipsisVertical, LuExternalLink, LuPencil } from "react-icons/lu";
import { Outlet, useNavigate, useParams } from "react-router";
import { ItemThumbnail } from "~/components";
import Grid from "~/components/Grid";
import Hyperlink from "~/components/Hyperlink";
import { useCurrencyFormatter } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { SupplierPartWithItem } from "~/modules/items";
import { getLinkToItemPurchasing } from "~/modules/items/ui/Item/ItemForm";
import { type ItemType, itemType } from "~/modules/shared";
import { path } from "~/utils/path";

type SupplierPartsProps = {
  supplierParts: SupplierPartWithItem[];
};

/** The supplier parts that name this supplier: one row per item it supplies. */
const SupplierParts = ({ supplierParts }: SupplierPartsProps) => {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const { t } = useLingui();
  const navigate = useNavigate();
  const formatter = useCurrencyFormatter();
  const customColumns = useCustomColumns<SupplierPartWithItem>("supplierPart");

  const columns = useMemo<ColumnDef<SupplierPartWithItem>[]>(() => {
    const defaultColumns: ColumnDef<SupplierPartWithItem>[] = [
      {
        id: "item",
        header: t`Item`,
        cell: ({ row }) => {
          const item = row.original.item;
          const type = (itemType as readonly string[]).includes(
            item?.type ?? ""
          )
            ? (item?.type as ItemType)
            : null;
          return (
            <HStack className="justify-between min-w-[200px]" spacing={2}>
              <HStack className="truncate" spacing={2}>
                <ItemThumbnail
                  size="sm"
                  thumbnailPath={item?.thumbnailPath}
                  type={type ?? "Part"}
                />
                <Hyperlink
                  to={path.to.supplierPart(supplierId, row.original.id!)}
                >
                  <VStack spacing={0}>
                    {item?.readableIdWithRevision}
                    {distinctItemText(
                      item?.readableIdWithRevision,
                      item?.name
                    ) && (
                      <div className="w-full truncate text-muted-foreground text-xs">
                        {item?.name}
                      </div>
                    )}
                  </VStack>
                </Hyperlink>
              </HStack>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label={t`Supplier part actions`}
                    icon={<LuEllipsisVertical />}
                    size="sm"
                    variant="ghost"
                    onClick={(e) => e.stopPropagation()}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    shortcut={MENU_ITEM_SHORTCUTS.edit}
                    onClick={() =>
                      navigate(
                        path.to.supplierPart(supplierId, row.original.id!)
                      )
                    }
                  >
                    <DropdownMenuIcon icon={<LuPencil />} />
                    <Trans>Edit Supplier Part</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    shortcut={MENU_ITEM_SHORTCUTS.view}
                    disabled={!type || !item?.id}
                    onClick={() => {
                      if (type && item?.id)
                        navigate(getLinkToItemPurchasing(type, item.id));
                    }}
                  >
                    <DropdownMenuIcon icon={<LuExternalLink />} />
                    <Trans>View Item</Trans>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </HStack>
          );
        }
      },
      {
        accessorKey: "supplierPartId",
        header: t`Supplier Part ID`,
        cell: (item) => item.getValue()
      },
      {
        accessorKey: "unitPrice",
        header: t`Unit Price`,
        cell: (item) => formatter.format(item.getValue<number>())
      },
      {
        accessorKey: "supplierUnitOfMeasureCode",
        header: t`Unit of Measure`,
        cell: (item) => item.getValue()
      },
      {
        accessorKey: "minimumOrderQuantity",
        header: t`Minimum Order Quantity`,
        cell: (item) => item.getValue()
      },
      {
        accessorKey: "conversionFactor",
        header: t`Conversion Factor`,
        cell: (item) => item.getValue()
      }
    ];

    return [...defaultColumns, ...customColumns];
  }, [customColumns, formatter, navigate, supplierId, t]);

  return (
    <>
      <Card className="w-full h-full min-h-[50vh]">
        <CardHeader>
          <CardTitle>
            <Trans>Supplier Parts</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Grid<SupplierPartWithItem>
            data={supplierParts}
            columns={columns}
            canEdit={false}
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default SupplierParts;
