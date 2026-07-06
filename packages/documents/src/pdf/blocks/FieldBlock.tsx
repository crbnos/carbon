import { Text, View } from "@react-pdf/renderer";
import type { FieldBlock as FieldBlockType } from "../../template";
import { interpolateString } from "../../template";
import { useTw } from "./tw";

/**
 * Extension block — doc-agnostic. A single line of plain text: an optional
 * bold `label` followed by an interpolated `value`. The simple alternative to
 * rich text when a user just needs one labelled line. Takes only the merge
 * `vars` so any document's registry can reuse it.
 */
export function FieldBlock({
  block,
  vars
}: {
  block: FieldBlockType;
  vars: Record<string, string>;
}) {
  const tw = useTw();
  const value = interpolateString(block.value ?? "", vars);
  if (!value && !block.label) return null;

  return (
    <View style={tw("flex flex-row mb-2 text-[10px] text-gray-800")}>
      {block.label ? (
        <>
          <Text style={tw("font-bold mr-1")}>{block.label}:</Text>
          <Text>{value}</Text>
        </>
      ) : (
        <Text>{value}</Text>
      )}
    </View>
  );
}
