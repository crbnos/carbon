import { Text, View } from "@react-pdf/renderer";
import type {
  ResolvedSection,
  SharedBlock as SharedBlockType
} from "../../template";
import { interpolateContent } from "../../template";
import { Note } from "../components";
import { useTw } from "./tw";

/** Extension block — doc-agnostic. Takes resolved sections + merge `vars`. */
export function SharedBlock({
  block,
  sections,
  vars
}: {
  block: SharedBlockType;
  sections: Record<string, ResolvedSection>;
  vars: Record<string, string>;
}) {
  const tw = useTw();
  const section = sections[block.sectionId];
  if (!section) return null;

  const hasContent =
    section.content &&
    typeof section.content === "object" &&
    Array.isArray(section.content.content) &&
    section.content.content.length > 0;

  if (!hasContent) return null;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
          {section.name}
        </Text>
        <View style={tw("text-[9px] text-gray-800")}>
          <Note content={interpolateContent(section.content, vars)} />
        </View>
      </View>
    </View>
  );
}
