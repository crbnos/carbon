// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { unchecked } from "@carbon/utils";
import { useCallback } from "react";
import { usePermissions } from "~/hooks";
import type { CustomerPart } from "../../../types";

export default function useCustomerParts() {
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "parts");
  const canDelete = permissions.can("delete", "parts");

  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: CustomerPart) => {
      if (!carbon) throw new Error("Carbon client not found");
      return await carbon
        .from("customerPartToItem")
        .update(
          unchecked({
            [id]: value
          })
        )
        .eq("id", row.id);
    },
    [carbon]
  );

  return {
    canDelete,
    canEdit,
    carbon,
    onCellEdit
  };
}
