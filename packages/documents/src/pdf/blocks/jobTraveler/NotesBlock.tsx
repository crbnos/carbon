// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  jobTravelerTexts,
  makeText,
  printedNotes
} from "../../../template";
import { Note } from "../../components";
import { tw } from "./tw";
import type { JobTravelerData } from "./types";

/** Job notes (rich text). Renders nothing when there are no notes. */
export function NotesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: JobTravelerData;
}) {
  const notes = printedNotes(block, data.notes);
  if (!notes) return null;
  const t = makeText(jobTravelerTexts.notes, block, data.vars);
  return (
    <View style={tw("mb-6")}>
      <Note title={t("jobNotes")} content={notes} />
    </View>
  );
}
