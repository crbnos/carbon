// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback } from "react";
import { useNavigate, useSubmit } from "react-router";
import { path } from "~/utils/path";
import type { SalesOrder } from "../../types";

export const useSalesOrder = () => {
  const navigate = useNavigate();
  const submit = useSubmit();

  const edit = useCallback(
    (salesOrder: Pick<SalesOrder, "id">) =>
      navigate(path.to.salesOrder(salesOrder.id!)),
    [navigate]
  );

  const invoice = useCallback(
    (salesOrder: Pick<SalesOrder, "id">) =>
      navigate(
        `${path.to.newSalesInvoice}?sourceDocument=Sales Order&sourceDocumentId=${salesOrder.id}`
      ),
    [navigate]
  );

  const ship = useCallback(
    (salesOrder: Pick<SalesOrder, "id">) => {
      const formData = new FormData();
      formData.set("sourceDocument", "Sales Order");
      formData.set("sourceDocumentId", salesOrder.id!);
      submit(formData, { method: "post", action: path.to.newShipment });
    },
    [submit]
  );

  return {
    edit,
    invoice,
    ship
  };
};
