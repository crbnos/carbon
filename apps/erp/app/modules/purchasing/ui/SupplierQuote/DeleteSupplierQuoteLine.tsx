// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getItemReadableId } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

export default function DeleteSupplierQuoteLine({
  line,
  onCancel
}: {
  line: { itemId: string; id: string };
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  if (!line.id) return null;

  const itemReadableId = getItemReadableId(items, line.itemId);

  return (
    <ConfirmDelete
      action={path.to.deleteSupplierQuoteLine(id, line.id)}
      name={itemReadableId ?? "this line"}
      text={t`Are you sure you want to delete the line: ${itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
