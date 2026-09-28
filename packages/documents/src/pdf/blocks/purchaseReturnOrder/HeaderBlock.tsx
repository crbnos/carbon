import { Header } from "../../components";
import type { PurchaseReturnOrderData } from "./types";

export function HeaderBlock({ data }: { data: PurchaseReturnOrderData }) {
  const supplierReference = data.purchaseReturnOrder?.supplierReference;
  return (
    <Header
      company={data.company}
      title="Return to Supplier"
      documentId={data.purchaseReturnOrder?.purchaseReturnOrderId}
      documentSubId={
        supplierReference ? `Supplier RMA #: ${supplierReference}` : undefined
      }
      currencyCode={data.purchaseReturnOrder?.currencyCode}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
