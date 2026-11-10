// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";
import type { PurchaseInvoiceLine } from "../../types";

export default function DeletePurchaseInvoiceLine({
  isOpen = true,
  line,
  onCancel
}: {
  isOpen?: boolean;
  line: PurchaseInvoiceLine;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("id not found");
  if (!line.id) return null;

  return (
    <ConfirmDelete
      isOpen={isOpen}
      action={path.to.deletePurchaseInvoiceLine(invoiceId, line.id)}
      name={line.itemReadableId ?? "this line"}
      text={t`Are you sure you want to delete the line: ${line.itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
