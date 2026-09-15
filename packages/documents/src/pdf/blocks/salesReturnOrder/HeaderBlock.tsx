import { Header } from "../../components";
import type { SalesReturnOrderData } from "./types";

export function HeaderBlock({ data }: { data: SalesReturnOrderData }) {
  return (
    <Header
      company={data.company}
      title="Return Merchandise Authorization"
      documentId={data.salesReturnOrder?.salesReturnOrderId}
      currencyCode={data.salesReturnOrder?.currencyCode}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
