// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { EditorBubbleItem, useEditor } from "@carbon/tiptap";
import { useLingui } from "@lingui/react/macro";
import {
  BsCodeSlash,
  BsTypeBold,
  BsTypeItalic,
  BsTypeStrikethrough,
  BsTypeUnderline
} from "react-icons/bs";

import { IconButton } from "../../IconButton";
import type { SelectorItem } from "./NodeSelector";

export const TextButtons = () => {
  const { editor } = useEditor();
  const { t } = useLingui();
  if (!editor) return null;

  const labels: Record<string, string> = {
    bold: t`Bold`,
    italic: t`Italic`,
    underline: t`Underline`,
    strike: t`Strikethrough`,
    code: t`Code`
  };

  const items: SelectorItem[] = [
    {
      name: "bold",
      isActive: (editor) => editor.isActive("bold"),
      command: (editor) => editor.chain().focus().toggleBold().run(),
      icon: BsTypeBold
    },
    {
      name: "italic",
      isActive: (editor) => editor.isActive("italic"),
      command: (editor) => editor.chain().focus().toggleItalic().run(),
      icon: BsTypeItalic
    },
    {
      name: "underline",
      isActive: (editor) => editor.isActive("underline"),
      command: (editor) => editor.chain().focus().toggleUnderline().run(),
      icon: BsTypeUnderline
    },
    {
      name: "strike",
      isActive: (editor) => editor.isActive("strike"),
      command: (editor) => editor.chain().focus().toggleStrike().run(),
      icon: BsTypeStrikethrough
    },
    {
      name: "code",
      isActive: (editor) => editor.isActive("code"),
      command: (editor) => editor.chain().focus().toggleCode().run(),
      icon: BsCodeSlash
    }
  ];

  return (
    <div className="flex">
      {items.map((item, index) => {
        const isActive = item.isActive(editor);
        return (
          <EditorBubbleItem
            key={index}
            onSelect={(editor) => {
              item.command(editor);
            }}
          >
            <IconButton
              aria-label={labels[item.name] ?? item.name}
              aria-pressed={isActive}
              icon={<item.icon />}
              variant={isActive ? "active" : "ghost"}
            />
          </EditorBubbleItem>
        );
      })}
    </div>
  );
};
