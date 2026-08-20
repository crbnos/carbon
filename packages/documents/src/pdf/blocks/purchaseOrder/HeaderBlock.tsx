import { getPurchaseOrderDisplayId } from "../../../utils/purchase-order";
import { Header } from "../../components";
import type { PurchaseOrderData } from "./types";

export function HeaderBlock({ data }: { data: PurchaseOrderData }) {
  return (
    <Header
      company={data.company}
      title="Purchase Order"
      documentId={
        data.purchaseOrder
          ? getPurchaseOrderDisplayId(data.purchaseOrder)
          : undefined
      }
      locale={data.locale}
      options={data.headerOptions}
      fixed
    />
  );
}
