import { Header } from "../../components";
import type { StockTransferData } from "./types";

export function HeaderBlock({ data }: { data: StockTransferData }) {
  return (
    <Header
      company={data.company}
      title="Stock Transfer"
      documentId={data.stockTransfer?.stockTransferId}
      date={data.stockTransfer?.createdAt}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
