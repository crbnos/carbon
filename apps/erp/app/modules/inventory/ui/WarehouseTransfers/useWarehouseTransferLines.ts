import { useFetcher } from "@remix-run/react";
import { useCallback } from "react";
import type { WarehouseTransfer } from "~/modules/inventory";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

export default function useWarehouseTransferLines(
  warehouseTransfer: WarehouseTransfer
) {
  const fetcher = useFetcher();
  const permissions = usePermissions();

  const isEditable = ["Draft", "To Ship and Receive", "To Ship"].includes(
    warehouseTransfer.status
  );
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
        action: path.to.warehouseTransferLines(warehouseTransfer.id),
      });
    },
    [canEdit, fetcher, warehouseTransfer.id]
  );

  return {
    canEdit,
    onCellEdit,
  };
}