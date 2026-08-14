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
