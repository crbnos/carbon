// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Header } from "../../components";
import type { PurchasingRfqData } from "./types";

export function HeaderBlock({ data }: { data: PurchasingRfqData }) {
  return (
    <Header
      company={data.company}
      title="Request for Quote"
      documentId={data.purchasingRfq?.rfqId}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
