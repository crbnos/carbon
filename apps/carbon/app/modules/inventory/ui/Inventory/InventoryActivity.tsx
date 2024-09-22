import { LuMinusCircle, LuPlusCircle } from "react-icons/lu";
import Activity from "~/components/Activity";
import type { ItemLedger } from "../../types";

const getActivityText = (ledgerRecord: ItemLedger) => {
  switch (ledgerRecord.entryType) {
    case "Positive Adjmt.":
      return `made a positive adjustment of ${ledgerRecord.quantity}${
        ledgerRecord.shelf?.name ? ` to ${ledgerRecord.shelf?.name}` : ""
      }`;
    case "Negative Adjmt.":
      return `made a negative adjustment of ${ledgerRecord.quantity}${
        ledgerRecord.shelf?.name ? ` to ${ledgerRecord.shelf.name}` : ""
      }`;
    default:
      return "";
  }
};

const getActivityIcon = (ledgerRecord: ItemLedger) => {
  switch (ledgerRecord.entryType) {
    case "Positive Adjmt.":
      return <LuPlusCircle className="text-blue-500 w-5 h-5" />;
    case "Negative Adjmt.":
      return <LuMinusCircle className="text-red-500 w-5 h-5" />;
    default:
      return "";
  }
};

type InventoryActivityProps = {
  item: ItemLedger;
};

const InventoryActivity = ({ item }: InventoryActivityProps) => {
  return (
    <Activity
      employeeId={item.createdBy}
      activityMessage={getActivityText(item)}
      activityTime={item.createdAt}
      activityIcon={getActivityIcon(item)}
    />
  );
};

export default InventoryActivity;
