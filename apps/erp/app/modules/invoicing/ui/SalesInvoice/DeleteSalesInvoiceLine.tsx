import { useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";
import type { SalesInvoiceLine } from "../../types";

export default function DeleteSalesInvoiceLine({
  line,
  onCancel,
}: {
  line: SalesInvoiceLine;
  onCancel: () => void;
}) {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("id not found");
  if (!line.id) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteSalesInvoiceLine(invoiceId, line.id)}
      name={line.itemReadableId ?? "this line"}
      text={`Are you sure you want to delete the line: ${line.itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
