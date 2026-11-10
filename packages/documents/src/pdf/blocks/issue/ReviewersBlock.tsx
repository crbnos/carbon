// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import { type DocumentBlock, issueTexts, makeText } from "../../../template";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { IssueData } from "./types";
import { buildIssueReviewerVars } from "./vars";

/** MRB reviewer list with per-reviewer status + notes. Empty → nothing. */
export function ReviewersBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: IssueData;
}) {
  const tw = useTw();
  const t = makeText(issueTexts.reviewers, block, data.vars);
  const { reviewers } = data;
  if (reviewers.length === 0) return null;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-2 uppercase")}>
          {t("mrb")}
        </Text>
        {reviewers.map((reviewer, index) => {
          const row = data.values.row(
            "reviewer",
            reviewer.id,
            buildIssueReviewerVars(reviewer)
          );
          return (
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
                  {t("titleCell", row)}
                </Text>
                <Text style={tw("text-[10px] text-gray-600")}>
                  {t("statusCell", row)}
                </Text>
              </View>

              {Object.keys(reviewer.notes ?? {}).length > 0 ? (
                <View style={tw("mt-1")}>
                  <Note content={reviewer.notes as JSONContent} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
