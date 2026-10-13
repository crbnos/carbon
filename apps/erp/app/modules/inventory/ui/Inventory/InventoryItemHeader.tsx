// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuEllipsis, LuExternalLink, LuX } from "react-icons/lu";
import { Link, useNavigate, useParams } from "react-router";
import { DetailsTopbar } from "~/components/Layout";
import { AppBarActions } from "~/components/Layout/Mobile/ChromeSlots";
import { useHideListAppBarMenu } from "~/components/Table/components/Compact/CompactToolbar";
import { useUrlParams } from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { useInventoryNavigation } from "./useInventoryNavigation";

type InventoryItemHeaderProps = {
  itemReadableId: string;
  itemType: MethodItemType;
};

const InventoryItemHeader = ({
  itemReadableId,
  itemType
}: InventoryItemHeaderProps) => {
  const links = useInventoryNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");
  const [params] = useUrlParams();

  const navigate = useNavigate();
  const { t } = useLingui();

  // Phones: this page owns the app bar ⋯ (the list behind it keeps out), and
  // the link to the item's own page lives there.
  useHideListAppBarMenu();

  return (
    <div>
      <VStack className="w-full">
        <div className="flex justify-between items-center border-b border-border p-2 bg-card w-full">
          <Button
            isIcon
            variant="ghost"
            className="max-md:hidden"
            onClick={() =>
              navigate(`${path.to.inventory}?${params.toString()}`)
            }
          >
            <LuX className="w-4 h-4" />
          </Button>
          <span className="flex items-center font-semibold text-center">
            <span className="max-md:hidden">{itemReadableId}</span>{" "}
            <Link
              to={getLinkToItemDetails(itemType, itemId)}
              className="ml-2 max-md:hidden"
            >
              <LuExternalLink />
            </Link>
          </span>
          <DetailsTopbar links={links} preserveParams />
        </div>
      </VStack>
      <AppBarActions>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`More options`}
              icon={<LuEllipsis />}
              variant="ghost"
              size="lg"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={getLinkToItemDetails(itemType, itemId)}>
                <DropdownMenuIcon icon={<LuExternalLink />} />
                <Trans>Item Master</Trans>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </AppBarActions>
    </div>
  );
};

export default InventoryItemHeader;
