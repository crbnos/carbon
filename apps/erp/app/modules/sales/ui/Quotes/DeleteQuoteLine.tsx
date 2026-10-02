// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getItemReadableId } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { QuotationLine } from "../../types";

export default function DeleteQuoteLine({
  line,
  onCancel
}: {
  line: QuotationLine;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("id not found");
  if (!line.id) return null;

  const itemReadableId = getItemReadableId(items, line.itemId);

  return (
    <ConfirmDelete
      action={path.to.deleteQuoteLine(quoteId, line.id)}
      name={itemReadableId ?? "this line"}
      text={t`Are you sure you want to delete the line: ${itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
