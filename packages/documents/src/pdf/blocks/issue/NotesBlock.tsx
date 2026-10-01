// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { IssueData } from "./types";

/** Description of the issue (rich text). Renders nothing when empty. */
export function NotesBlock({ data }: { data: IssueData }) {
  const tw = useTw();
  const { nonConformance } = data;
  if (Object.keys(nonConformance.content ?? {}).length === 0) return null;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
          Description of Issue
        </Text>
        <View style={tw("mt-1")}>
          <Note content={nonConformance.content as JSONContent} />
        </View>
      </View>
    </View>
  );
}
