// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  issueTexts,
  makeText,
  printedNotes
} from "../../../template";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { IssueData } from "./types";

/** Description of the issue (rich text). Renders nothing when empty. */
export function NotesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: IssueData;
}) {
  const tw = useTw();
  const t = makeText(issueTexts.notes, block, data.vars);
  const content = printedNotes(block, data.nonConformance.content) ?? {};
  if (Object.keys(content).length === 0) return null;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
          {t("descriptionOfIssue")}
        </Text>
        <View style={tw("mt-1")}>
          <Note content={content} />
        </View>
      </View>
    </View>
  );
}
