import { formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { useTw } from "../tw";
import type { IssueData } from "./types";

/** Two-column issue metadata box (name/type/status/initiator + dates). */
export function IssueDetailsBlock({ data }: { data: IssueData }) {
  const tw = useTw();
  const { nonConformance, nonConformanceTypes, assignees, locale } = data;
  const ncType = nonConformanceTypes.find(
    (type) => type.id === nonConformance.nonConformanceTypeId
  );

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Issue Details
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {nonConformance.name && (
              <Text style={tw("font-bold")}>{nonConformance.name}</Text>
            )}
            {ncType?.name && (
              <Text style={tw("mt-1")}>Type: {ncType.name}</Text>
            )}
            {nonConformance.status && (
              <Text>Status: {nonConformance.status}</Text>
            )}
            <Text>
              Initiated By: {assignees[nonConformance.createdBy] || "Unknown"}
            </Text>
          </View>
        </View>
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Dates
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {nonConformance.openDate && (
              <Text>
                Started:{" "}
                {formatDate(nonConformance.openDate, undefined, locale)}
              </Text>
            )}
            {nonConformance.closeDate && (
              <Text>
                Completed:{" "}
                {formatDate(nonConformance.closeDate, undefined, locale)}
              </Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
