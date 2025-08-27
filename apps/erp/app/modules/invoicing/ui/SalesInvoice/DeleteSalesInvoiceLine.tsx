import { getItemReadableId } from "@carbon/utils";
import { useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { SalesInvoiceLine } from "../../types";

export default function DeleteSalesInvoiceLine({
  line,
  onCancel,
}: {
  line: SalesInvoiceLine;
  onCancel: () => void;
}) {
  const [items] = useItems();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("id not found");
  if (!line.id) return null;

  const itemReadableId = getItemReadableId(items, line.itemId);

  return (
    <ConfirmDelete
      action={path.to.deleteSalesInvoiceLine(invoiceId, line.id)}
      name={itemReadableId ?? "this line"}
      text={`Are you sure you want to delete the line: ${itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
