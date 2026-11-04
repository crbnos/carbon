// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { type DocumentBlock, issueTexts, makeText } from "../../../template";
import { useTw } from "../tw";
import type { IssueData } from "./types";

/** Two-column issue metadata box (name/type/status/initiator + dates). */
export function IssueDetailsBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: IssueData;
}) {
  const tw = useTw();
  const t = makeText(issueTexts.issueDetails, block, data.vars);
  const { nonConformance, nonConformanceTypes, assignees, locale } = data;
  const ncType = nonConformanceTypes.find(
    (type) => type.id === nonConformance.nonConformanceTypeId
  );

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("issueDetails")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {nonConformance.name ? (
              <Text style={tw("font-bold")}>{nonConformance.name}</Text>
            ) : null}
            {t.shows("type") && ncType?.name ? (
              <Text style={tw("mt-1")}>
                {t("type")} {ncType.name}
              </Text>
            ) : null}
            {t.shows("status") && nonConformance.status ? (
              <Text>
                {t("status")} {nonConformance.status}
              </Text>
            ) : null}
            {t.shows("initiatedBy") ? (
              <Text>
                {t("initiatedBy")}{" "}
                {assignees[nonConformance.createdBy] || t("unknown")}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("dates")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {t.shows("started") && nonConformance.openDate ? (
              <Text>
                {t("started")}{" "}
                {formatDate(nonConformance.openDate, undefined, locale)}
              </Text>
            ) : null}
            {t.shows("completed") && nonConformance.closeDate ? (
              <Text>
                {t("completed")}{" "}
                {formatDate(nonConformance.closeDate, undefined, locale)}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
