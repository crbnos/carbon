// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  printedNotes,
  type TermsBlock,
  type TextEntry
} from "../../template";
import { Note } from "../components";
import { hasContent, resolveTerms } from "./resolveTerms";
import { useTw } from "./tw";

/** The Terms block most documents print: its heading, then the terms. */
export function DocumentTerms({
  block,
  texts,
  terms: fallback,
  vars,
  accent
}: {
  block: TermsBlock;
  texts: readonly (TextEntry & { key: "termsAndConditions" })[];
  terms: JSONContent | undefined;
  vars: Record<string, string>;
  accent: string;
}) {
  const tw = useTw();
  const terms = resolveTerms(block, fallback, vars);
  const t = makeText(texts, block, vars);
  if (!hasContent(terms)) return null;

  return (
    <View break>
      <View style={tw("border-b border-gray-400 mb-3 pb-2 mt-2")}>
        <Text
          style={[
            tw("text-[14px] font-bold uppercase tracking-wide"),
            { color: accent }
          ]}
        >
          {t("termsAndConditions")}
        </Text>
      </View>
      <Note content={terms!} />
    </View>
  );
}

/** The Notes block most documents print: a box with the record's notes, or a word. */
export function DocumentNotes({
  block,
  texts,
  notes,
  vars
}: {
  block: DocumentBlock;
  texts: readonly (TextEntry & { key: "notes" | "none" })[];
  notes: unknown;
  vars: Record<string, string>;
}) {
  const tw = useTw();
  const t = makeText(texts, block, vars);
  const content = printedNotes(block, notes) ?? {};

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
          {t("notes")}
        </Text>
        <View style={tw("text-[9px] text-gray-800")}>
          {Object.keys(content).length > 0 ? (
            <Note content={content} />
          ) : (
            <Text style={tw("text-gray-400")}>{t("none")}</Text>
          )}
        </View>
      </View>
    </View>
  );
}
