import { useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";
import type { PurchaseOrderLine } from "../../types";

export default function DeletePurchaseOrderLine({
  line,
  onCancel,
}: {
  line: PurchaseOrderLine;
  onCancel: () => void;
}) {
  const { orderId } = useParams();
  if (!orderId) throw new Error("id not found");
  if (!line.id) return null;

  return (
    <ConfirmDelete
      action={path.to.deletePurchaseOrderLine(orderId, line.id)}
      name={line.itemReadableId ?? "this line"}
      text={`Are you sure you want to delete the line: ${line.itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
