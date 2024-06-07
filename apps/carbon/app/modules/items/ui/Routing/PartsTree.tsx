import { Button, HStack, useMount } from "@carbon/react";
import { useState } from "react";
import { AiOutlineCodeSandbox } from "react-icons/ai";
import { BsCaretDownFill } from "react-icons/bs";

type PartsTreeNode = {
  id: string;
  type: "folder" | "file";
  children?: PartsTreeNode[];
};

const data: PartsTreeNode[] = [
  {
    id: "F012345",
    type: "folder",
    children: [
      {
        id: "F505555",
        type: "file",
      },
      {
        id: "F505556",
        type: "file",
      },
    ],
  },
];

const PartsTreeExplorer = () => {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>(
    {}
  );

  useMount(() => {
    const map: Record<string, boolean> = {};
    const traverse = (node: PartsTreeNode[]) => {
      node.forEach((n) => {
        map[n.id] = true; // open all nodes by default;
        if (n.children) {
          traverse(n.children);
        }
      });
    };

    traverse(data);
    setExpandedNodes(map);
  });

  const toggleNode = (id: string) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const renderPartsTree = (data: PartsTreeNode[], level: number = 0) => {
    return data.map((node) => {
      return (
        <div className="block p-0" role="group" key={node.id}>
          <HStack
            className="items-stretch border-2 border-transparent :active:border-blue-200"
            style={{
              paddingLeft: `calc(${1.5 * level}rem)`,
            }}
          >
            <Button
              variant="ghost"
              aria-label="Expand"
              className="rounded-none"
              onClick={() => toggleNode(node.id)}
              isDisabled={!node.children}
            >
              <BsCaretDownFill
                className="w-4 h-4"
                style={{
                  transition: "transform .25s ease",
                  transform:
                    expandedNodes[node.id] || !node.children
                      ? undefined
                      : "rotate(-0.25turn)",
                }}
              />
            </Button>
            <Button
              variant="ghost"
              leftIcon={<AiOutlineCodeSandbox />}
              className="rounded-none flex-1 justify-start"
            >
              {node.id}
            </Button>
          </HStack>
          {node.children &&
            expandedNodes[node.id] &&
            renderPartsTree(node.children, level + 1)}
        </div>
      );
    });
  };

  return <div role="tree">{renderPartsTree(data)}</div>;
};

export default PartsTreeExplorer;
