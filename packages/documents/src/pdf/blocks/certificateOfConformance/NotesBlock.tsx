import type { JSONContent } from "@carbon/react";
import { View } from "@react-pdf/renderer";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { CertificateOfConformanceData } from "./types";

export function NotesBlock({ data }: { data: CertificateOfConformanceData }) {
  const tw = useTw();
  const notes = data.notes as JSONContent | null | undefined;
  if (
    !notes ||
    typeof notes !== "object" ||
    !Array.isArray(notes.content) ||
    notes.content.length === 0
  ) {
    return null;
  }

  return (
    <View style={tw("mb-3 w-full")}>
      <Note title="Notes" content={notes} />
    </View>
  );
}
