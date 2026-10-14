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
  Input,
  InputGroup,
  InputLeftElement,
  MENU_ITEM_SHORTCUTS
} from "@carbon/react";
import { distinctItemText } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuEllipsisVertical,
  LuExternalLink,
  LuPencil,
  LuSearch
} from "react-icons/lu";
import { Link, useNavigate, useParams } from "react-router";
import { ItemThumbnail, New } from "~/components";
import { usePermissions, useUser } from "~/hooks";
import type { SupplierPartWithItem } from "~/modules/items";
import { getLinkToItemPurchasing } from "~/modules/items/ui/Item/ItemForm";
import { SupplierPartPrice } from "~/modules/items/ui/Item/SupplierParts";
import { type ItemType, itemType } from "~/modules/shared";
import { path } from "~/utils/path";

type SupplierPartsProps = {
  supplierParts: SupplierPartWithItem[];
};

function matchesSearch(supplierPart: SupplierPartWithItem, query: string) {
  return [
    supplierPart.item?.readableIdWithRevision,
    supplierPart.item?.name,
    supplierPart.supplierPartId
  ].some((value) => value?.toLowerCase().includes(query));
}

/** The supplier parts that name this supplier: one row per item it supplies. */
const SupplierParts = ({ supplierParts }: SupplierPartsProps) => {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const canCreate = permissions.can("create", "parts");
  const { company } = useUser();

  // Local state rather than a URL param: opening a row's drawer and closing it
  // navigates without the query string, and the search should survive that.
  const [search, setSearch] = useState("");
  const searchText = search.trim();
  const query = searchText.toLowerCase();
  const filteredParts = useMemo(
    () =>
      query
        ? supplierParts.filter((supplierPart) =>
            matchesSearch(supplierPart, query)
          )
        : supplierParts,
    [supplierParts, query]
  );

  return (
    <Card>
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>
            <Trans>Supplier Parts</Trans>
          </CardTitle>
        </CardHeader>
        <CardAction>
          <HStack>
            {supplierParts.length > 0 && (
              <InputGroup size="sm">
                <InputLeftElement>
                  <LuSearch className="text-muted-foreground w-3.5 h-3.5 mt-[-2px]" />
                </InputLeftElement>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t`Search`}
                  aria-label={t`Search supplier parts`}
                  className="w-[160px] sm:w-[240px] text-sm"
                />
              </InputGroup>
            )}
            {canCreate && <New to={path.to.newSupplierPart(supplierId)} />}
          </HStack>
        </CardAction>
      </HStack>
      <CardContent>
        {supplierParts.length === 0 ? (
          <div className="my-8 text-center w-full">
            <p className="text-muted-foreground text-sm">
              <Trans>No supplier parts have been added yet.</Trans>
            </p>
          </div>
        ) : filteredParts.length === 0 ? (
          <div className="my-8 text-center w-full">
            <p className="text-muted-foreground text-sm">
              <Trans>No supplier parts match "{searchText}".</Trans>
            </p>
          </div>
        ) : (
          <ul className="w-full divide-y divide-border">
            {filteredParts.map((supplierPart) => {
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
              // A supplier part's price is in its own currency (NULL = base),
              // per the supplier's unit of measure.
              const currencyCode =
                supplierPart.currencyCode ?? company.baseCurrencyCode;

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
                      {supplierPart.supplierPartId && (
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {supplierPart.supplierPartId}
                        </p>
                      )}
                    </div>
                  </div>

                  {supplierPart.supplierUnitPrice !== null && (
                    <p className="shrink-0 text-sm tabular-nums">
                      <SupplierPartPrice
                        price={supplierPart.supplierUnitPrice}
                        currencyCode={currencyCode}
                      />
                      {supplierPart.supplierUnitOfMeasureCode && (
                        <span className="text-muted-foreground">
                          {" / "}
                          {supplierPart.supplierUnitOfMeasureCode}
                        </span>
                      )}
                      <span className="ml-2 font-mono text-muted-foreground">
                        {currencyCode}
                      </span>
                    </p>
                  )}

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
                      {type && item?.id ? (
                        <DropdownMenuItem
                          shortcut={MENU_ITEM_SHORTCUTS.view}
                          asChild
                        >
                          <Link to={getLinkToItemPurchasing(type, item.id)}>
                            <LuExternalLink className="mr-2" />
                            <Trans>View Item</Trans>
                          </Link>
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          shortcut={MENU_ITEM_SHORTCUTS.view}
                          disabled
                        >
                          <LuExternalLink className="mr-2" />
                          <Trans>View Item</Trans>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default SupplierParts;
