import { LuMinusCircle, LuPlusCircle } from "react-icons/lu";
import Activity from "~/components/Activity";
import type { ItemLedger } from "../../types";

type InventoryActivityProps = {
  itemLedgerRecords: ItemLedger[];
};

const getActivityText = (ledgerRecord: ItemLedger) => {
  switch (ledgerRecord.entryType) {
    case "Positive Adjmt.":
      return `made a positive adjustment of ${ledgerRecord.quantity}`;
    case "Negative Adjmt.":
      return `made a negative adjustment of ${ledgerRecord.quantity}`;
    default:
      return "";
  }
};

const getActivityIcon = (ledgerRecord: ItemLedger) => {
  switch (ledgerRecord.entryType) {
    case "Positive Adjmt.":
      return <LuPlusCircle className="text-blue-500" />;
    case "Negative Adjmt.":
      return <LuMinusCircle className="text-red-500" />;
    default:
      return "";
  }
};

const InventoryActivity = ({ itemLedgerRecords }: InventoryActivityProps) => {
  return (
    <>
      <div className="space-y-4">
        {itemLedgerRecords.map((ledgerRecord, index) => (
          <Activity
            key={index}
            employeeId={ledgerRecord.createdBy}
            activityMessage={getActivityText(ledgerRecord)}
            activityTime={ledgerRecord.createdAt}
            activityIcon={getActivityIcon(ledgerRecord)}
          />
        ))}
      </div>
    </>
  );
};

export default InventoryActivity;
