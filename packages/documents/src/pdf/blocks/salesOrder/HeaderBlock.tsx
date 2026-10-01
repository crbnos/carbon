// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Header } from "../../components";
import type { SalesOrderData } from "./types";

export function HeaderBlock({ data }: { data: SalesOrderData }) {
  return (
    <Header
      company={data.company}
      title="Sales Order"
      documentId={data.salesOrder?.salesOrderId}
      currencyCode={data.salesOrder?.currencyCode}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
