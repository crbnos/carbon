// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { View } from "@react-pdf/renderer";
import { Note } from "../../components";
import { useTw } from "../tw";
import type { CertificateOfConformanceData } from "./types";

export function NotesBlock({ data }: { data: CertificateOfConformanceData }) {
  const tw = useTw();
  const notes = data.notes as JSONContent | null | undefined;
  if (
    !notes ||
    typeof notes !== "object" ||
    !Array.isArray(notes.content) ||
    notes.content.length === 0
  ) {
    return null;
  }

  return (
    <View style={tw("mb-3 w-full")}>
      <Note title="Notes" content={notes} />
    </View>
  );
}
