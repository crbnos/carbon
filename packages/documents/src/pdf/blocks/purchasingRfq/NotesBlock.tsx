// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { PurchasingRfqData } from "./types";

export function NotesBlock({ data }: { data: PurchasingRfqData }) {
  const tw = useTw();
  const notes = (data.purchasingRfq?.notes ?? {}) as JSONContent;
  if (Object.keys(notes).length === 0) return null;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
          Notes
        </Text>
        <View style={tw("text-[9px] text-gray-800")}>
          <Note content={notes} />
        </View>
      </View>
    </View>
  );
}
