// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Editor, Range } from "@tiptap/core";
import { useCurrentEditor } from "@tiptap/react";
import { CommandEmpty, CommandItem } from "cmdk";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";
import { useCommandStore } from "../utils/store";

interface EditorCommandItemProps {
  readonly onCommand: ({
    editor,
    range
  }: {
    editor: Editor;
    range: Range;
  }) => void;
}

export const EditorCommandItem = forwardRef<
  HTMLDivElement,
  EditorCommandItemProps & ComponentPropsWithoutRef<typeof CommandItem>
>(({ children, onCommand, ...rest }, ref) => {
  const { editor } = useCurrentEditor();
  const range = useCommandStore((state) => state.range);

  if (!editor || !range) return null;

  return (
    <CommandItem
      ref={ref}
      {...rest}
      onSelect={() => onCommand({ editor, range })}
    >
      {children}
    </CommandItem>
  );
});

EditorCommandItem.displayName = "EditorCommandItem";

export const EditorCommandEmpty = CommandEmpty;

export default EditorCommandItem;
