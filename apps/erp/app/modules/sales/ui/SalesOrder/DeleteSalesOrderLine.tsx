import { useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";
import type { SalesOrderLine } from "../../types";

export default function DeleteSalesOrderLine({
  line,
  onCancel,
}: {
  line: SalesOrderLine;
  onCancel: () => void;
}) {
  const { orderId } = useParams();
  if (!orderId) throw new Error("id not found");
  if (!line.id) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteSalesOrderLine(orderId, line.id)}
      name={line.itemReadableId ?? "this line"}
      text={`Are you sure you want to delete the line: ${line.itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
