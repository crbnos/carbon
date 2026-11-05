// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  const initiatedBy = {
    "issue.initiatedBy": data.vars["issue.initiatedBy"] || t("unknown")
  };

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("issueDetails")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {t.prints("name") ? (
              <Text style={tw("font-bold")}>{t("name")}</Text>
            ) : null}
            {t.prints("type") ? (
              <Text style={tw("mt-1")}>{t("type")}</Text>
            ) : null}
            {t.prints("status") ? <Text>{t("status")}</Text> : null}
            {t.prints("initiatedBy", initiatedBy) ? (
              <Text>{t("initiatedBy", initiatedBy)}</Text>
            ) : null}
          </View>
        </View>
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("dates")}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {t.prints("started") ? <Text>{t("started")}</Text> : null}
            {t.prints("completed") ? <Text>{t("completed")}</Text> : null}
          </View>
        </View>
      </View>
    </View>
  );
}
