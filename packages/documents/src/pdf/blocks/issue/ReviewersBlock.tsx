import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { IssueData } from "./types";

/** MRB reviewer list with per-reviewer status + notes. Empty → nothing. */
export function ReviewersBlock({ data }: { data: IssueData }) {
  const tw = useTw();
  const { reviewers } = data;
  if (reviewers.length === 0) return null;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-2 uppercase")}>
          MRB
        </Text>
        {reviewers.map((reviewer, index) => (
          <View
            key={reviewer.id}
            style={tw(
              `flex flex-col gap-1 py-2 ${
                index < reviewers.length - 1 ? "border-b border-gray-200" : ""
              }`
            )}
          >
            <View style={tw("flex flex-row justify-between")}>
              <Text style={tw("text-[10px] font-bold text-gray-800")}>
                {reviewer.title}
              </Text>
              <Text style={tw("text-[10px] text-gray-600")}>
                {reviewer.status}
              </Text>
            </View>

            {Object.keys(reviewer.notes ?? {}).length > 0 && (
              <View style={tw("mt-1")}>
                <Note content={reviewer.notes as JSONContent} />
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
