// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import type { RichTextBlock as RichTextBlockType } from "../../template";
import { interpolateContent } from "../../template";
import { Note } from "../components";
import { useTw } from "./tw";

/**
 * Extension block — doc-agnostic. Takes only the merge-field `vars` so any
 * document's registry can reuse it.
 */
export function RichTextBlock({
  block,
  vars
}: {
  block: RichTextBlockType;
  vars: Record<string, string>;
}) {
  const tw = useTw();
  const hasContent =
    block.content &&
    typeof block.content === "object" &&
    Array.isArray(block.content.content) &&
    block.content.content.length > 0;

  if (!hasContent && !block.title) return null;

  const content = hasContent
    ? interpolateContent(block.content, vars)
    : block.content;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        {block.title ? (
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {block.title}
          </Text>
        ) : null}
        {hasContent ? (
          <View style={tw("text-[9px] text-gray-800")}>
            <Note content={content} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
