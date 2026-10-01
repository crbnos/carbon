// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Header } from "../../components";
import type { StockTransferData } from "./types";

export function HeaderBlock({ data }: { data: StockTransferData }) {
  return (
    <Header
      company={data.company}
      title="Stock Transfer"
      documentId={data.stockTransfer?.stockTransferId}
      date={data.stockTransfer?.createdAt}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
