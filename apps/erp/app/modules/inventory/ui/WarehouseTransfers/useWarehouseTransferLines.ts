// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { useCallback } from "react";
import { usePermissions } from "~/hooks";
import type { WarehouseTransfer } from "~/modules/inventory/types";
import { path } from "~/utils/path";

export default function useWarehouseTransferLines(
  warehouseTransfer: WarehouseTransfer
) {
  // A refused edit is toasted.
  const fetcher = useAction();
  const permissions = usePermissions();

  const isEditable = ["Draft"].includes(warehouseTransfer.status);
  const canEdit = isEditable && permissions.can("update", "inventory");

  const onCellEdit = useCallback(
    (id: string, value: any, field: string) => {
      if (!canEdit) return;

      const formData = new FormData();
      formData.append("type", "update");
      formData.append("id", id);
      formData.append(field, value?.toString() ?? "");

      fetcher.submit(formData, {
        method: "post",
        action: path.to.warehouseTransferLine(warehouseTransfer.id, id)
      });
    },
    [canEdit, fetcher, warehouseTransfer.id]
  );

  return {
    canEdit,
    onCellEdit
  };
}
