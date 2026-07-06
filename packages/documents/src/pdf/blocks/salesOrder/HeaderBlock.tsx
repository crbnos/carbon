import { Header } from "../../components";
import type { SalesOrderData } from "./types";

export function HeaderBlock({ data }: { data: SalesOrderData }) {
  return (
    <Header
      company={data.company}
      title="Sales Order"
      documentId={data.salesOrder?.salesOrderId}
      currencyCode={data.salesOrder?.currencyCode}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
