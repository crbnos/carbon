import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import { Note } from "../components";
import { useTw } from "./tw";
import type { SalesInvoiceData } from "./types";

export function NotesBlock({ data }: { data: SalesInvoiceData }) {
  const tw = useTw();
  const { salesInvoice } = data;
  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
          Notes
        </Text>
        <View style={tw("text-[9px] text-gray-800")}>
          {Object.keys(salesInvoice?.externalNotes ?? {}).length > 0 ? (
            <Note content={(salesInvoice.externalNotes ?? {}) as JSONContent} />
          ) : (
            <Text style={tw("text-gray-400")}>None</Text>
          )}
        </View>
      </View>
    </View>
  );
}
