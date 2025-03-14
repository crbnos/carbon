import { SelectControlled, Hidden, Combobox } from "@carbon/form";
import { useMount, VStack } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { PostgrestResponse } from "@supabase/supabase-js";
import { useState, useEffect, useMemo } from "react";
import { path } from "~/utils/path";

export function QuoteLineMethodForm() {
  const quoteFetcher =
    useFetcher<PostgrestResponse<{ id: string; quoteId: string }>>();
  const quoteLineFetcher = useFetcher<
    PostgrestResponse<{
      id: string;
      itemReadableId: string;
      description: string;
    }>
  >();

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
        label: quote.quoteId,
        value: quote.id,
      })) ?? [],
    [quoteFetcher.data]
  );

  const quoteLineOptions = useMemo(
    () =>
      quoteLineFetcher.data?.data?.map((quoteLine) => ({
        label: quoteLine.itemReadableId,
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
