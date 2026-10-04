// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Combobox, Hidden, SelectControlled } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useMemo, useState } from "react";
import { RevisionSuffix } from "~/components";
import { path } from "~/utils/path";
import type { getQuoteLinesList } from "../../sales.service";

export function QuoteLineMethodForm() {
  const { t } = useLingui();
  const quoteFetcher = useLoaderQuery<
    PostgrestResponse<{ id: string; quoteId: string; revisionId: number }>
  >(path.to.api.quotes);

  // const quotesLoading = quoteFetcher.isFetching;
  // const quoteLinesLoading = quoteLineFetcher.isFetching;
  const [quote, setQuote] = useState<string | null>(null);

  const quoteLineFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getQuoteLinesList>>
  >(quote ? path.to.api.quoteLines(quote) : null);
  const [quoteLine, setQuoteLine] = useState<string | null>(null);

  const quoteOptions = useMemo(
    () =>
      quoteFetcher.data?.data?.map((quote) => ({
        label: (
          <div className="flex justify-start items-center gap-0">
            <span>{quote.quoteId}</span>
            <RevisionSuffix revisionId={quote.revisionId} />
          </div>
        ),
        value: quote.id
      })) ?? [],
    [quoteFetcher.data]
  );

  const quoteLineOptions = useMemo(
    () =>
      quoteLineFetcher.data?.data?.map((quoteLine) => ({
        label: quoteLine.readableIdWithRevision ?? "",
        value: quoteLine.id
      })) ?? [],
    [quoteLineFetcher.data]
  );

  return (
    <>
      <VStack spacing={4} className="w-full">
        <Combobox
          name="quoteId"
          label={t`Quote`}
          options={quoteOptions}
          placeholder={t`Select a quote`}
          onChange={(newValue) => {
            if (newValue) {
              setQuote(newValue.value);
              setQuoteLine(null);
            }
          }}
        />
        <SelectControlled
          name="quoteLineId"
          label={t`Quote Line`}
          options={quoteLineOptions}
          placeholder={t`Select a quote line`}
          isReadOnly={!quote}
          onChange={(newValue) => {
            if (newValue) {
              setQuoteLine(newValue.value);
            }
          }}
        />
      </VStack>
      <Hidden
        name="sourceId"
        className="-my-4"
        value={quoteLine ? `${quote}:${quoteLine}` : ""}
      />
    </>
  );
}
