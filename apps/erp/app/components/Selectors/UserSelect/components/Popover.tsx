// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useViewport } from "@carbon/react";
import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import useUserSelectContext from "../provider";

const Popover = ({ children }: PropsWithChildren) => {
  const { isPhone } = useViewport();
  const {
    aria: { popoverProps },
    dropdown,
    refs: { listBoxRef, popoverRef, focusableNodes }
  } = useUserSelectContext();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    /* Build a triple linked-list (TreeNode[]) of the focusable tree items in
    DOM order, at any nesting depth.

    type TreeNode {
      uid: string;
      expandable: boolean;   // from data-expandable (group rows)
      previousId?: string;
      nextId?: string;
      parentId?: string;     // nearest ancestor treeitem
    }
    */

    focusableNodes.current = {};

    if (!listBoxRef.current) return;

    const elements = Array.from(
      listBoxRef.current.querySelectorAll<HTMLElement>('[role="treeitem"]')
    ).filter((el) => el.id);

    const nodes: [string, string | undefined, boolean][] = elements.map(
      (el) => {
        const parent =
          el.parentElement?.closest<HTMLElement>('[role="treeitem"]');
        return [
          el.id,
          parent?.id || undefined,
          el.getAttribute("data-expandable") === "true"
        ];
      }
    );

    for (let i = 0; i < nodes.length; i++) {
      const [uid, parentId, expandable] = nodes[i];

      focusableNodes.current[uid] = {
        uid,
        expandable,
        parentId,
        previousId: nodes[i - 1]?.[0] || undefined,
        nextId: nodes[i + 1]?.[0] || undefined
      };
    }
  }, [children, focusableNodes, listBoxRef]);

  return (
    <>
      {/* Phones: the list is a bottom sheet over a dimmed screen. The scrim
          sits inside the select's container, so the outside-click handler
          never sees a tap on it; it closes the sheet itself. */}
      {isPhone && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-black/40"
          onPointerDown={(event) => {
            event.preventDefault();
            dropdown.onClose();
          }}
        />
      )}
      <div
        {...popoverProps}
        ref={popoverRef}
        className="absolute w-full mt-1 px-2 bg-popover text-popover-foreground shadow-sm border border-border rounded-md min-w-[240px] z-50 max-md:fixed max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:mt-0 max-md:max-h-[88dvh] max-md:min-w-0 max-md:overflow-y-auto max-md:rounded-none max-md:rounded-t-[14px] max-md:border-0 max-md:px-2 max-md:pt-2 max-md:pb-safe-4"
      >
        {children}
      </div>
    </>
  );
};

export default Popover;
