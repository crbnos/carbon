import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { QuoteData } from "./types";

export function NotesBlock({ data }: { data: QuoteData }) {
  const tw = useTw();
  const notes = (data.quote?.externalNotes ?? {}) as JSONContent;
  const hasNotes = Object.keys(notes).length > 0;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
          Notes
        </Text>
        <View style={tw("text-[9px] text-gray-800")}>
          {hasNotes ? (
            <Note content={notes} />
          ) : (
            <Text style={tw("text-gray-400")}>None</Text>
          )}
        </View>
      </View>
    </View>
  );
}
