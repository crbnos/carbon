import { Header } from "../../components";
import type { PackingSlipData } from "./types";

export function HeaderBlock({ data }: { data: PackingSlipData }) {
  return (
    <Header
      company={data.company}
      title="Packing Slip"
      documentId={data.shipment?.shipmentId}
      date={data.shipment?.postingDate}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
