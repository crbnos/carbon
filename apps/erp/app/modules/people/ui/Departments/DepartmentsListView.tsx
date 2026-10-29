// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  MENU_ITEM_SHORTCUTS
} from "@carbon/react";
import {
  LuBuilding,
  LuChevronRight,
  LuEllipsisVertical,
  LuPencil,
  LuPlus,
  LuTrash2
} from "react-icons/lu";
import type { DepartmentTreeNode } from "../../types";

interface DepartmentsListViewProps {
  departments: DepartmentTreeNode[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}

function DepartmentsRow({
  department,
  departments,
  depth,
  onEdit,
  onDelete,
  onAddChild
}: {
  department: DepartmentTreeNode;
  departments: DepartmentTreeNode[];
  depth: number;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}) {
  const children = departments.filter(
    (d) => d.parentDepartmentId === department.id
  );

  return (
    <div>
      <div
        className="flex items-center gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-accent/50"
        style={{ paddingLeft: `${depth * 28 + 16}px` }}
      >
        {children.length > 0 ? (
          <LuChevronRight className="size-4 text-muted-foreground" />
        ) : (
          <div className="size-4" />
        )}

        <div className="flex size-8 shrink-0 items-center justify-center bg-muted">
          <LuBuilding className="size-3.5 text-muted-foreground" />
        </div>

        <div className="flex flex-col gap-0 min-w-0">
          <span className="text-sm font-medium text-foreground">
            {department.name}
          </span>
        </div>

        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="Actions"
                icon={<LuEllipsisVertical />}
              />
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
      </div>

      {children.map((child) => (
        <DepartmentsRow
          key={child.id}
          department={child}
          departments={departments}
          depth={depth + 1}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  );
}

export function DepartmentsListView({
  departments,
  onEdit,
  onDelete,
  onAddChild
}: DepartmentsListViewProps) {
  const roots = departments.filter((d) => d.parentDepartmentId === null);

  return (
    <div className="bg-card overflow-hidden h-full">
      <div className="grid grid-cols-[1fr_auto] items-center border-b border-border bg-card h-11 px-6">
        <span className="text-sm font-medium text-foreground/80">
          Department
        </span>
        <span className="text-sm font-medium text-foreground/80">Actions</span>
      </div>
      {roots.map((root) => (
        <DepartmentsRow
          key={root.id}
          department={root}
          departments={departments}
          depth={0}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  );
}
