import { Combobox, Hidden, SelectControlled } from "@carbon/form";
import { useMount, VStack } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { path } from "~/utils/path";
import type { getQuoteLinesList } from "../../sales.service";

export function QuoteLineMethodForm() {
  const quoteFetcher =
    useFetcher<
      PostgrestResponse<{ id: string; quoteId: string; revisionId: number }>
    >();
  const quoteLineFetcher =
    useFetcher<Awaited<ReturnType<typeof getQuoteLinesList>>>();

  // const quotesLoading = quoteFetcher.state === "loading";
  // const quoteLinesLoading = quoteLineFetcher.state === "loading";
  const [quote, setQuote] = useState<string | null>(null);
  const [quoteLine, setQuoteLine] = useState<string | null>(null);

  useMount(() => {
    quoteFetcher.load(path.to.api.quotes);
  });

  useEffect(() => {
    if (quote) {
      quoteLineFetcher.load(path.to.api.quoteLines(quote));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  const quoteOptions = useMemo(
    () =>
      quoteFetcher.data?.data?.map((quote) => ({
        label: (
          <div className="flex justify-start items-center gap-0">
            <span>{quote.quoteId}</span>
            {(quote.revisionId ?? 0) > 0 && (
              <span className="text-muted-foreground">-{quote.revisionId}</span>
            )}
          </div>
        ),
        value: quote.id,
      })) ?? [],
    [quoteFetcher.data]
  );

  const quoteLineOptions = useMemo(
    () =>
      quoteLineFetcher.data?.data?.map((quoteLine) => ({
        label: quoteLine.readableIdWithRevision ?? "",
        value: quoteLine.id,
      })) ?? [],
    [quoteLineFetcher.data]
  );

  return (
    <>
      <VStack spacing={4} className="w-full">
        <Combobox
          name="quoteId"
          label="Quote"
          options={quoteOptions}
          placeholder="Select a quote"
          onChange={(newValue) => {
            if (newValue) {
              setQuote(newValue.value);
              setQuoteLine(null);
            }
          }}
        />
        <SelectControlled
          name="quoteLineId"
          label="Quote Line"
          options={quoteLineOptions}
          placeholder="Select a quote line"
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
