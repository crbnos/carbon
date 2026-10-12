// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { BubbleMenuProps } from "@tiptap/react";
import { BubbleMenu, isNodeSelection, useCurrentEditor } from "@tiptap/react";
import type { ReactNode } from "react";
import { forwardRef, useEffect, useMemo, useRef } from "react";
import type { Instance, Props } from "tippy.js";

export interface EditorBubbleProps extends Omit<BubbleMenuProps, "editor"> {
  readonly children: ReactNode;
}

export const EditorBubble = forwardRef<HTMLDivElement, EditorBubbleProps>(
  ({ children, tippyOptions, ...rest }, ref) => {
    const { editor: currentEditor } = useCurrentEditor();
    const instanceRef = useRef<Instance<Props> | null>(null);

    useEffect(() => {
      if (!instanceRef.current || !tippyOptions?.placement) return;

      instanceRef.current.setProps({ placement: tippyOptions.placement });
      instanceRef.current.popperInstance?.update();
    }, [tippyOptions?.placement]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    const bubbleMenuProps: Omit<BubbleMenuProps, "children"> = useMemo(() => {
      const shouldShow: BubbleMenuProps["shouldShow"] = ({ editor, state }) => {
        const { selection } = state;
        const { empty } = selection;

        // don't show bubble menu if:
        // - the editor is not editable
        // - the selected node is an image
        // - the selection is empty
        // - the selection is a node selection (for drag handles)
        if (
          !editor.isEditable ||
          editor.isActive("image") ||
          empty ||
          isNodeSelection(selection)
        ) {
          return false;
        }
        return true;
      };

      return {
        shouldShow,
        tippyOptions: {
          onCreate: (val) => {
            instanceRef.current = val;

            instanceRef.current.popper.firstChild?.addEventListener(
              "blur",
              (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
              }
            );
          },
          moveTransition: "transform 0.15s ease-out",
          ...tippyOptions
        },
        editor: currentEditor,
        ...rest
      };
      // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    }, [rest, tippyOptions]);

    if (!currentEditor) return null;

    return (
      // We need to add this because of https://github.com/ueberdosis/tiptap/issues/2658
      <div ref={ref}>
        <BubbleMenu {...bubbleMenuProps}>{children}</BubbleMenu>
      </div>
    );
  }
);

EditorBubble.displayName = "EditorBubble";

export default EditorBubble;
