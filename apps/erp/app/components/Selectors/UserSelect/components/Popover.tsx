import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import useUserSelectContext from "../provider";

const Popover = ({ children }: PropsWithChildren) => {
  const {
    aria: { popoverProps },
    refs: { listBoxRef, popoverRef, focusableNodes },
  } = useUserSelectContext();

  useEffect(() => {
    /* Build a triple linked-list (TreeNode[]) of focusable DOM Elements that are children 
    
    type TreeNode {
      id: string;
      expandable: boolean;
      previousId?: string;
      nextId?: string;
      parentId? string;
    } 
    
    */

    focusableNodes.current = {};

    /* First get the parents */
    const parents: Element[] = [];
    if (listBoxRef.current) {
      let node = listBoxRef.current.firstElementChild;
      let lastNode = listBoxRef.current.lastElementChild;

      while (node && node !== lastNode) {
        parents.push(node);
        node = node.nextElementSibling;
      }

      if (node) {
        parents.push(node);
      }
    }

    /* Then make a flat list with the children spliced in */
    const nodes: [string, string | undefined][] = [];

    parents.forEach((parent) => {
      nodes.push([parent.id, undefined]);
      const group = parent.getElementsByTagName("ul");
      if (group?.[0]) {
        let child = group[0].firstElementChild;
        let lastChild = group[0].lastElementChild;

        while (child && child !== lastChild) {
          nodes.push([child.id, parent.id]);
          child = child.nextElementSibling;
        }

        if (child) {
          nodes.push([child.id, parent.id]);
        }
      }
    });

    /* Finally, create the triple linked list */
    for (let i = 0; i < nodes.length; i++) {
      const [node, parent] = nodes[i];
      const previous = nodes?.[i - 1];
      const next = nodes?.[i + 1];

      focusableNodes.current[node] = {
        uid: node,
        expandable: parent === undefined,
        parentId: parent,
        previousId: previous?.[0] || undefined,
        nextId: next?.[0] || undefined,
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
