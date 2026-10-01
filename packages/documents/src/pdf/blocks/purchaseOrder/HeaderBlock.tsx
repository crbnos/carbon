// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getPurchaseOrderDisplayId } from "../../../utils/purchase-order";
import { Header } from "../../components";
import type { PurchaseOrderData } from "./types";

export function HeaderBlock({ data }: { data: PurchaseOrderData }) {
  return (
    <Header
      company={data.company}
      title="Purchase Order"
      documentId={
        data.purchaseOrder
          ? getPurchaseOrderDisplayId(data.purchaseOrder)
          : undefined
      }
      locale={data.locale}
      options={data.headerOptions}
      fixed
    />
  );
}
