import { Text, View } from "@react-pdf/renderer";
import type { KeyValueBlock as KeyValueBlockType } from "../../template";
import { interpolateString } from "../../template";
import { useTw } from "./tw";

/** Extension block — doc-agnostic. Takes only the merge-field `vars`. */
export function KeyValueBlock({
  block,
  vars
}: {
  block: KeyValueBlockType;
  vars: Record<string, string>;
}) {
  const tw = useTw();
  const rows = block.rows ?? [];
  if (rows.length === 0 && !block.title) return null;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        {block.title && (
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {block.title}
          </Text>
        )}
        <View style={tw("text-[9px] text-gray-800")}>
          {rows.map((row, index) => (
            <View
              key={`${row.label}-${index}`}
              style={tw("flex flex-row mb-0.5")}
            >
              <Text style={tw("w-1/3 text-gray-600")}>
                {interpolateString(row.label, vars)}
              </Text>
              <Text style={tw("w-2/3 text-gray-800")}>
                {interpolateString(row.value, vars)}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
