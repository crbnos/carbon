import { Text, View } from "@react-pdf/renderer";
import type { CustomFieldBlock as CustomFieldBlockType } from "../../template";
import { useTw } from "./tw";

function formatValue(raw: unknown): string {
  if (raw === "on" || raw === true) return "Yes";
  if (raw === "off" || raw === false) return "No";
  if (raw == null) return "—";
  return String(raw);
}

/** Extension block — doc-agnostic. Takes the record's `customFields` map. */
export function CustomFieldBlock({
  block,
  customFields
}: {
  block: CustomFieldBlockType;
  customFields: Record<string, unknown>;
}) {
  const tw = useTw();
  const value = formatValue(customFields[block.fieldId]);

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row p-3 text-[9px]")}>
        <Text style={tw("w-1/3 text-gray-600")}>{block.label || "—"}</Text>
        <Text style={tw("w-2/3 text-gray-800")}>{value}</Text>
      </View>
    </View>
  );
}
