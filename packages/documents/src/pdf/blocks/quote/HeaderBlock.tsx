import { Header } from "../../components";
import type { QuoteData } from "./types";

export function HeaderBlock({ data }: { data: QuoteData }) {
  return (
    <Header
      company={data.company}
      title="Quote"
      documentId={data.quote?.quoteId}
      currencyCode={data.quote?.currencyCode}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
