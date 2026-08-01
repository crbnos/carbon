import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuEllipsisVertical, LuTrash2 } from "react-icons/lu";
import type { BuilderNode } from "../../../types";
import { catalog } from "../catalog";
import { useBuilderStore } from "../context";
import { DeleteNodeDialog } from "../DeleteNodeDialog";

type NodeMenuProps = {
  node: BuilderNode;
};

export function NodeMenu({ node }: NodeMenuProps) {
  const { t } = useLingui();
  const isReadOnly = useBuilderStore((s) => s.isReadOnly);
  const setNodeExpanded = useBuilderStore((s) => s.setNodeExpanded);
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isReadOnly) return null;

  const isExpanded = node.expanded !== false;
  const isAction = node.type === "action";
  const actionId = isAction
    ? (node.data.action as string | undefined)
    : undefined;
  const actionDef = actionId ? catalog.getAction(actionId) : undefined;
  const isBatchable = !!actionDef?.batchable;
  const isBatch = node.data.batch === true;
  const canDelete = node.type !== "trigger";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label={t`Step options`}
            variant="ghost"
            size="sm"
            icon={<LuEllipsisVertical />}
            className="nodrag nopan"
            onClick={(event) => event.stopPropagation()}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => setNodeExpanded(node.id, !isExpanded)}
          >
            {isExpanded ? t`Minimize` : t`Expand`}
          </DropdownMenuItem>
          {isBatchable && (
            <DropdownMenuCheckboxItem
              checked={isBatch}
              onCheckedChange={() =>
                updateNodeData(node.id, { batch: !isBatch })
              }
            >
              {t`Run once for each item in the list`}
            </DropdownMenuCheckboxItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <MenuItem destructive onClick={() => setDeleteOpen(true)}>
                <MenuIcon icon={<LuTrash2 />} />
                {t`Delete`}
              </MenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {deleteOpen && (
        <DeleteNodeDialog
          nodeId={node.id}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </>
  );
}
