import { useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";
import type { PurchasingRFQLine } from "../../types";

export default function DeletePurchasingRFQLine({
  line,
  onCancel
}: {
  line: PurchasingRFQLine;
  onCancel: () => void;
}) {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("id not found");
  if (!line.id) return null;

  return (
    <ConfirmDelete
      action={path.to.deletePurchasingRfqLine(rfqId, line.id)}
      name={line.description ?? "this line"}
      text={`Are you sure you want to delete the line: ${line.description}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
