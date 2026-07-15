import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import useUserSelectContext from "../provider";

const Popover = ({ children }: PropsWithChildren) => {
  const {
    aria: { popoverProps },
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
    <div
      {...popoverProps}
      ref={popoverRef}
      className="absolute w-full mt-1 px-2 bg-popover text-popover-foreground shadow-sm border border-border rounded-md min-w-[240px] z-50"
    >
      {children}
    </div>
  );
};

export default Popover;
