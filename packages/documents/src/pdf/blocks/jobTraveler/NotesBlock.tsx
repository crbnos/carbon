import { View } from "@react-pdf/renderer";
import { Note } from "../../components";
import { tw } from "./tw";
import type { JobTravelerData } from "./types";

/** Job notes (rich text). Renders nothing when there are no notes. */
export function NotesBlock({ data }: { data: JobTravelerData }) {
  if (!data.notes) return null;
  return (
    <View style={tw("mb-6")}>
      <Note title="Job Notes" content={data.notes} />
    </View>
  );
}
