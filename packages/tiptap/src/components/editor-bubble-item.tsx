// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Slot } from "@radix-ui/react-slot";
import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef } from "react";

interface EditorBubbleItemProps {
  readonly children: ReactNode;
  readonly asChild?: boolean;
  readonly onSelect?: (editor: Editor) => void;
}

export const EditorBubbleItem = forwardRef<
  HTMLDivElement,
  EditorBubbleItemProps & Omit<ComponentPropsWithoutRef<"div">, "onSelect">
>(({ children, asChild, onSelect, ...rest }, ref) => {
  const { editor } = useCurrentEditor();
  const Comp = asChild ? Slot : "div";

  if (!editor) return null;

  return (
    <Comp ref={ref} {...rest} onClick={() => onSelect?.(editor)}>
      {children}
    </Comp>
  );
});

EditorBubbleItem.displayName = "EditorBubbleItem";

export default EditorBubbleItem;
