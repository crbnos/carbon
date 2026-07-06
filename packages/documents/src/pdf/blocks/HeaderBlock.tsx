import { Header } from "../components";
import type { SalesInvoiceData } from "./types";

export function HeaderBlock({ data }: { data: SalesInvoiceData }) {
  return (
    <Header
      company={data.company}
      title="Invoice"
      documentId={data.salesInvoice?.invoiceId}
      currencyCode={data.salesInvoice?.currencyCode}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
