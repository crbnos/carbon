// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ITEM_TYPE_PAGES } from "@carbon/database/access";
import { getItemById } from "@carbon/utils";
import { usePermissions } from "~/hooks";
import { useItems } from "~/stores";

/**
 * Whether the person may edit a make method: Edit on the page of the method's
 * item (Tools for a tool's method) and a Draft method. Each editor adds its
 * own locks on top.
 */
export function useMethodEditable(makeMethod: {
  itemId: string;
  status: string;
}) {
  const permissions = usePermissions();
  const [items] = useItems();
  const methodItem = getItemById(items, makeMethod.itemId);
  const isEditable =
    !!methodItem &&
    permissions.has({ [ITEM_TYPE_PAGES[methodItem.type]]: "Edit" }) &&
    makeMethod.status === "Draft";
  return { methodItem, isEditable };
}
