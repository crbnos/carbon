// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export { type Editor as EditorInstance } from "@tiptap/core";
export type { JSONContent } from "@tiptap/react";
export { useCurrentEditor as useEditor } from "@tiptap/react";

export { EditorContent, type EditorContentProps, EditorRoot } from "./editor";
export { EditorBubble } from "./editor-bubble";
export { EditorBubbleItem } from "./editor-bubble-item";
export { EditorCommand, EditorCommandList } from "./editor-command";
export { EditorCommandEmpty, EditorCommandItem } from "./editor-command-item";
export {
  MentionList,
  type MentionListProps,
  type MentionListRef
} from "./mention-list";
