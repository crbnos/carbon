// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";
import type { SalesOrderLine } from "../../types";

export default function DeleteSalesOrderLine({
  line,
  onCancel
}: {
  line: SalesOrderLine;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const { orderId } = useParams();
  if (!orderId) throw new Error("id not found");
  if (!line.id) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteSalesOrderLine(orderId, line.id)}
      name={line.itemReadableId ?? "this line"}
      text={t`Are you sure you want to delete the line: ${line.itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
