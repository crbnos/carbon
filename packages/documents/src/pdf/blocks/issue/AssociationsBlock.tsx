import { Text, View } from "@react-pdf/renderer";
import { useTw } from "../tw";
import type { Associations, IssueData } from "./types";

/** A single labeled association row (label + readable id). */
function Row({ label, value }: { label: string; value: string }) {
  const tw = useTw();
  const rowStyle = tw(
    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
  );
  return (
    <View style={rowStyle}>
      <Text style={tw("w-1/4 font-bold text-gray-600")}>{label}:</Text>
      <Text style={tw("text-gray-800")}>{value}</Text>
    </View>
  );
}

/** Groups that render as a plain label + documentReadableId, in order. */
const SIMPLE_GROUPS: { key: keyof Associations; label: string }[] = [
  { key: "customers", label: "Customer" },
  { key: "suppliers", label: "Supplier" },
  { key: "jobOperations", label: "Job Operation" },
  { key: "purchaseOrderLines", label: "Purchase Order" },
  { key: "salesOrderLines", label: "Sales Order" },
  { key: "shipmentLines", label: "Shipment" },
  { key: "receiptLines", label: "Receipt" },
  { key: "trackedEntities", label: "Tracked Entity" }
];

/** Related entities grouped by type. Renders nothing when there are none. */
export function AssociationsBlock({ data }: { data: IssueData }) {
  const tw = useTw();
  const rowStyle = tw(
    "flex flex-row gap-2 text-[10px] py-1 border-b border-gray-200"
  );
  const { associations } = data;
  if (!associations) return null;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
          Associations
        </Text>
        <View style={tw("flex flex-col")}>
          {associations.items?.map((item) => (
            <View key={item.id} style={rowStyle}>
              <Text style={tw("w-1/4 font-bold text-gray-600")}>Item:</Text>
              <Text style={tw("text-gray-800")}>{item.documentReadableId}</Text>
              {item.disposition && (
                <>
                  <Text style={tw("text-gray-400")}>-</Text>
                  <Text style={tw("text-gray-800")}>{item.disposition}</Text>
                </>
              )}
              {item.quantity && (
                <>
                  <Text style={tw("text-gray-400")}>-</Text>
                  <Text style={tw("text-gray-800")}>Qty: {item.quantity}</Text>
                </>
              )}
            </View>
          ))}
          {SIMPLE_GROUPS.flatMap(({ key, label }) =>
            (associations[key] ?? []).map((row) => (
              <Row key={row.id} label={label} value={row.documentReadableId} />
            ))
          )}
        </View>
      </View>
    </View>
  );
}
