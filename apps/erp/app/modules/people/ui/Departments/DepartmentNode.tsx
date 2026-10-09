// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MENU_ITEM_SHORTCUTS,
  useViewport
} from "@carbon/react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import {
  LuBuilding,
  LuEllipsisVertical,
  LuPencil,
  LuPlus,
  LuTrash2
} from "react-icons/lu";
import type { DepartmentTreeNode } from "../../types";

interface DepartmentNodeData extends Record<string, unknown> {
  department: DepartmentTreeNode;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}

function DepartmentNodeComponent({
  data
}: NodeProps & { data: DepartmentNodeData }) {
  const { department, onEdit, onDelete, onAddChild } = data;
  // Phones lay the tree out left-to-right, so edges attach at the sides.
  const { isPhone } = useViewport();

  return (
    <div className="group relative">
      <Handle
        type="target"
        position={isPhone ? Position.Left : Position.Top}
        className="!bg-transparent !border-0 !w-px !h-px !min-w-0 !min-h-0"
      />

      <div
        className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md"
        style={{ minWidth: 170, maxWidth: 220 }}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <LuBuilding className="size-4 text-muted-foreground" />
        </div>

        <div className="flex flex-col gap-0.5 overflow-hidden min-w-0">
          <span className="truncate text-sm font-medium leading-tight text-foreground">
            {department.name}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="ml-auto shrink-0 rounded-md p-1 md:opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus:opacity-100 max-md:hit-area"
              aria-label="Actions"
            >
              <LuEllipsisVertical className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem
              shortcut={MENU_ITEM_SHORTCUTS.edit}
              onClick={() => onEdit(department.id!)}
            >
              <LuPencil className="mr-2 size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAddChild(department.id!)}>
              <LuPlus className="mr-2 size-4" />
              Add department
            </DropdownMenuItem>
            <DropdownMenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(department.id!)}
            >
              <LuTrash2 className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Handle
        type="source"
        position={isPhone ? Position.Right : Position.Bottom}
        className="!bg-transparent !border-0 !w-px !h-px !min-w-0 !min-h-0"
      />
    </div>
  );
}

export const DepartmentNode = memo(DepartmentNodeComponent);
