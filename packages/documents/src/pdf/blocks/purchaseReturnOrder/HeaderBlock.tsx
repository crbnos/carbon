// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Header } from "../../components";
import type { PurchaseReturnOrderData } from "./types";

export function HeaderBlock({ data }: { data: PurchaseReturnOrderData }) {
  return (
    <Header
      company={data.company}
      title={data.documentTitle}
      documentId={data.documentNumber}
      documentSubId={data.supplierRmaLine}
      currencyCode={data.purchaseReturnOrder?.currencyCode}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
