import { useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { useItems } from "~/stores";
import { getItemReadableId } from "~/utils/items";
import { path } from "~/utils/path";
import type { PurchaseOrderLine } from "../../types";

export default function DeletePurchaseOrderLine({
  line,
  onCancel,
}: {
  line: PurchaseOrderLine;
  onCancel: () => void;
}) {
  const [items] = useItems();
  const { orderId } = useParams();
  if (!orderId) throw new Error("id not found");
  if (!line.id) return null;

  const itemReadableId = getItemReadableId(items, line.itemId);

  return (
    <ConfirmDelete
      action={path.to.deletePurchaseOrderLine(orderId, line.id)}
      name={itemReadableId ?? "this line"}
      text={`Are you sure you want to delete the line: ${itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
