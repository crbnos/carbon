import { useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { useItems } from "~/stores";
import { getItemReadableId } from "~/utils/items";
import { path } from "~/utils/path";
import type { QuotationLine } from "../../types";

export default function DeleteQuoteLine({
  line,
  onCancel,
}: {
  line: QuotationLine;
  onCancel: () => void;
}) {
  const [items] = useItems();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("id not found");
  if (!line.id) return null;

  const itemReadableId = getItemReadableId(items, line.itemId);

  return (
    <ConfirmDelete
      action={path.to.deleteQuoteLine(quoteId, line.id)}
      name={itemReadableId ?? "this line"}
      text={`Are you sure you want to delete the line: ${itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
