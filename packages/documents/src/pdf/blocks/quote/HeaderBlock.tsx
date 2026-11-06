// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Header } from "../../components";
import type { QuoteData } from "./types";

export function HeaderBlock({ data }: { data: QuoteData }) {
  return (
    <Header
      company={data.company}
      title={data.documentTitle}
      documentId={data.documentNumber}
      currencyCode={data.quote?.currencyCode}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
