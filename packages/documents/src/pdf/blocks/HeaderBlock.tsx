// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Header } from "../components";
import type { SalesInvoiceData } from "./types";

export function HeaderBlock({ data }: { data: SalesInvoiceData }) {
  return (
    <Header
      company={data.company}
      title="Invoice"
      documentId={data.salesInvoice?.invoiceId}
      currencyCode={data.salesInvoice?.currencyCode}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
