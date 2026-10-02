// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Header } from "../../components";
import type { SalesReturnOrderData } from "./types";

export function HeaderBlock({ data }: { data: SalesReturnOrderData }) {
  return (
    <Header
      company={data.company}
      title="Return Merchandise Authorization"
      documentId={data.salesReturnOrder?.salesReturnOrderId}
      currencyCode={data.salesReturnOrder?.currencyCode}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
