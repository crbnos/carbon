import { IconButton, ScrollArea } from "@carbon/react";
import { useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import { useBuilderStore } from "../context";
import { DeleteNodeDialog } from "../DeleteNodeDialog";
import { NODE_KIND_META } from "../nodes/meta";
import { NODE_FORMS } from "./forms/index";
import { NodeNameField } from "./NodeNameField";

const RAIL_HEADING =
  "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function ConfigPanel() {
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const nodes = useBuilderStore((s) => s.nodes);
  const issues = useBuilderStore((s) => s.issues);
  const node = nodes.find((n) => n.id === selectedNodeId);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">
          Select a step to configure it
        </p>
      </div>
    );
  }

  const meta = NODE_KIND_META[node.type];
  const Form = NODE_FORMS[node.type];
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);
  const canDelete = node.type !== "trigger";

  return (
    <>
      <ScrollArea className="h-full bg-card">
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <div className={RAIL_HEADING}>{meta.name}</div>
            {canDelete && (
              <IconButton
                aria-label="Delete step"
                variant="ghost"
                size="sm"
                icon={<LuTrash2 className="text-destructive" />}
                onClick={() => setDeleteOpen(true)}
              />
            )}
          </div>
          <NodeNameField key={node.id} node={node} />
          <Form key={node.id} node={node} issues={nodeIssues} />
        </div>
      </ScrollArea>
      {deleteOpen && (
        <DeleteNodeDialog
          nodeId={node.id}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </>
  );
}
