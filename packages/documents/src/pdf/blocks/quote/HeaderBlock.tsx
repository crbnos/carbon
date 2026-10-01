// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getQuoteDisplayId } from "../../../utils/quote";
import { Header } from "../../components";
import type { QuoteData } from "./types";

export function HeaderBlock({ data }: { data: QuoteData }) {
  return (
    <Header
      company={data.company}
      title="Quote"
      documentId={data.quote ? getQuoteDisplayId(data.quote) : undefined}
      currencyCode={data.quote?.currencyCode}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
