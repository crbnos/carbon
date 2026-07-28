import { Text, View } from "@react-pdf/renderer";
import { tw } from "./tw";
import type { JobTravelerData } from "./types";

/**
 * Materials (BOM) required for the make method. Rendered only when the company
 * has opted in (`includeMaterials`) and there are materials to show, so the
 * default traveler behavior is unchanged.
 */
export function MaterialsBlock({ data }: { data: JobTravelerData }) {
  const materials = data.jobMaterials ?? [];
  if (!data.includeMaterials || materials.length === 0) return null;

  const labels = data.materialsLabels;

  return (
    <View style={tw("mb-6 text-xs")}>
      <Text style={tw("text-[9px] font-bold text-gray-600 uppercase mb-2")}>
        {labels?.heading ?? "Materials"}
      </Text>

      <View
        style={tw(
          "flex flex-row justify-between items-center py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase page-break-inside-avoid gap-x-6"
        )}
      >
        <Text style={tw("w-4/12 text-left")}>
          {labels?.material ?? "Material"}
        </Text>
        <Text style={tw("w-5/12 text-left")}>
          {labels?.description ?? "Description"}
        </Text>
        <Text style={tw("w-3/12 text-right")}>
          {labels?.quantity ?? "Quantity"}
        </Text>
      </View>

      {materials.map((material) => {
        const quantity = material.unitOfMeasureCode
          ? `${material.quantity} ${material.unitOfMeasureCode}`
          : `${material.quantity}`;

        return (
          <View
            style={tw(
              "flex flex-row justify-between items-start py-3 px-[6px] border-b border-gray-300 page-break-inside-avoid gap-x-6"
            )}
            key={material.id}
          >
            <Text style={tw("w-4/12 text-left font-bold")}>
              {material.item?.readableIdWithRevision ?? ""}
            </Text>
            <Text style={tw("w-5/12 text-left")}>{material.description}</Text>
            <Text style={tw("w-3/12 text-right")}>{quantity}</Text>
          </View>
        );
      })}
    </View>
  );
}
