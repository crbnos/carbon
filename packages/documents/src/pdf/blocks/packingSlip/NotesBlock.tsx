// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  packingSlipTexts,
  printedNotes
} from "../../../template";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { PackingSlipData } from "./types";

export function NotesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: PackingSlipData;
}) {
  const tw = useTw();
  const t = makeText(packingSlipTexts.notes, block, data.vars);
  const notes = printedNotes(block, data.shipment?.externalNotes) ?? {};
  if (Object.keys(notes).length === 0) return null;

  return (
    <View style={tw("mb-3 w-full")}>
      <Note title={t("notes")} content={notes} />
    </View>
  );
}
