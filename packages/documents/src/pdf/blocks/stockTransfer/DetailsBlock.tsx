import { formatDate } from "@carbon/utils";
import { View } from "@react-pdf/renderer";
import { Summary } from "../../components";
import { useTw } from "../tw";
import type { StockTransferData } from "./types";

/** Company + transfer metadata (date, id, location, assignee). */
export function DetailsBlock({ data }: { data: StockTransferData }) {
  const tw = useTw();
  const { company, stockTransfer, location, locale } = data;

  const items: { label: string; value: string | null | undefined }[] = [
    {
      label: "Date",
      value: stockTransfer?.createdAt
        ? formatDate(stockTransfer.createdAt, undefined, locale)
        : ""
    },
    { label: "Stock Transfer", value: stockTransfer?.stockTransferId },
    { label: "Location", value: location?.name }
  ];
  if (stockTransfer?.assignee) {
    items.push({ label: "Assignee", value: stockTransfer.assignee });
  }

  return (
    <View style={tw("mb-4")}>
      <Summary company={company} items={items} />
    </View>
  );
}
