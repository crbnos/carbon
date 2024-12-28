import { useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";
import type { SalesRFQLine } from "../../types";

export default function DeleteSalesRFQLine({
  line,
  onCancel,
}: {
  line: SalesRFQLine;
  onCancel: () => void;
}) {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("id not found");
  if (!line.id) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteSalesRfqLine(rfqId, line.id)}
      name={line.customerPartId ?? "this line"}
      text={`Are you sure you want to delete the line: ${line.customerPartId}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
