import { Header } from "../../components";
import type { PurchaseOrderData } from "./types";

export function HeaderBlock({ data }: { data: PurchaseOrderData }) {
  return (
    <Header
      company={data.company}
      title="Purchase Order"
      documentId={data.purchaseOrder?.purchaseOrderId}
      locale={data.locale}
      options={data.headerOptions}
      fixed
    />
  );
}
