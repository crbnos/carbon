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
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS
} from "@carbon/react";
import { distinctItemText } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuEllipsisVertical, LuExternalLink, LuPencil } from "react-icons/lu";
import { Link, Outlet, useNavigate, useParams } from "react-router";
import { ItemThumbnail, New } from "~/components";
import {
  useCurrencyFormatter,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import type { SupplierPartWithItem } from "~/modules/items";
import { getLinkToItemPurchasing } from "~/modules/items/ui/Item/ItemForm";
import type { SupplierDetail } from "~/modules/purchasing";
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
  const permissions = usePermissions();
  const canCreate = permissions.can("create", "parts");
  // A supplier part's price is in its supplier's currency, the company's base
  // currency when the supplier has none.
  const { company } = useUser();
  const routeData = useRouteData<{ supplier: SupplierDetail }>(
    path.to.supplier(supplierId)
  );
  const currency =
    routeData?.supplier?.currencyCode ?? company.baseCurrencyCode;
  const formatter = useCurrencyFormatter({ rate: true, currency });

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Supplier Parts</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction>
            {canCreate && <New to={path.to.newSupplierPart(supplierId)} />}
          </CardAction>
        </HStack>
        <CardContent>
          {supplierParts.length === 0 ? (
            <div className="my-8 text-center w-full">
              <p className="text-muted-foreground text-sm">
                <Trans>No supplier parts have been added yet.</Trans>
              </p>
            </div>
          ) : (
            <ul className="w-full divide-y divide-border">
              {supplierParts.map((supplierPart) => {
                const item = supplierPart.item;
                const type = (itemType as readonly string[]).includes(
                  item?.type ?? ""
                )
                  ? (item?.type as ItemType)
                  : null;
                const editPath = path.to.supplierPart(
                  supplierId,
                  supplierPart.id!
                );

                return (
                  <li
                    key={supplierPart.id}
                    className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <ItemThumbnail
                        size="md"
                        thumbnailPath={item?.thumbnailPath}
                        type={type ?? "Part"}
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          to={editPath}
                          className="block truncate text-sm font-medium hover:underline"
                        >
                          {item?.readableIdWithRevision}
                        </Link>
                        {distinctItemText(
                          item?.readableIdWithRevision,
                          item?.name
                        ) && (
                          <p className="truncate text-sm text-muted-foreground">
                            {item?.name}
                          </p>
                        )}
                      </div>
                    </div>

                    <p className="shrink-0 text-sm tabular-nums">
                      {formatter.format(supplierPart.unitPrice ?? 0)}
                      <span className="ml-2 font-mono text-muted-foreground">
                        {currency}
                      </span>
                    </p>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          aria-label={t`Supplier part actions`}
                          icon={<LuEllipsisVertical />}
                          variant="secondary"
                          className="shrink-0"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          shortcut={MENU_ITEM_SHORTCUTS.edit}
                          onClick={() => navigate(editPath)}
                        >
                          <LuPencil className="mr-2" />
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
                          <LuExternalLink className="mr-2" />
                          <Trans>View Item</Trans>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default SupplierParts;
