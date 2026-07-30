import { Text, View } from "@react-pdf/renderer";
import { tw } from "./tw";
import type { JobTravelerData } from "./types";

/**
 * Opt-in Bill of Materials table (item, description, method type, quantity).
 * Rendered only when the company setting `includeMaterialsOnTraveler` is on and
 * the make method has materials — see JobTravelerPageContent.
 */
export function MaterialsBlock({ data }: { data: JobTravelerData }) {
  const materials = data.materials ?? [];
  if (materials.length === 0) return null;

  return (
    <View style={tw("mb-6 text-xs")}>
      <View
        style={tw(
          "flex flex-row justify-between items-center py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase page-break-inside-avoid gap-x-6"
        )}
      >
        <Text style={tw("w-3/12 text-left")}>Item</Text>
        <Text style={tw("w-5/12 text-left")}>Description</Text>
        <Text style={tw("w-2/12 text-left")}>Method</Text>
        <Text style={tw("w-2/12 text-right")}>Quantity</Text>
      </View>

      {materials.map((material) => (
        <View
          style={tw(
            "flex flex-row justify-between items-start border-b border-gray-300 py-3 px-[6px] page-break-inside-avoid gap-x-6"
          )}
          key={material.id}
          wrap={false}
        >
          <Text style={tw("w-3/12 text-left font-bold")}>
            {material.itemReadableId ?? ""}
          </Text>
          <Text style={tw("w-5/12 text-left")}>{material.description}</Text>
          <Text style={tw("w-2/12 text-left text-[10px]")}>
            {material.methodType ?? ""}
          </Text>
          <Text style={tw("w-2/12 text-right")}>
            {material.quantity}
            {material.unitOfMeasureCode ? ` ${material.unitOfMeasureCode}` : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}
