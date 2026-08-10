import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import {
  LuCircleDollarSign,
  LuEllipsisVertical,
  LuPencil,
  LuPlus,
  LuTrash2
} from "react-icons/lu";
import type { CostCenterTreeNode } from "../../types";

interface CostCenterNodeData extends Record<string, unknown> {
  costCenter: CostCenterTreeNode;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}

function CostCenterNodeComponent({
  data
}: NodeProps & { data: CostCenterNodeData }) {
  const { t } = useLingui();
  const { costCenter, onEdit, onDelete, onAddChild } = data;

  return (
    <div className="group relative">
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-transparent !border-0 !w-px !h-px !min-w-0 !min-h-0"
      />

      <div
        className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md"
        style={{ minWidth: 170, maxWidth: 220 }}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <LuCircleDollarSign className="size-4 text-muted-foreground" />
        </div>

        <div className="flex flex-col gap-0.5 overflow-hidden min-w-0">
          <span className="truncate text-sm font-medium leading-tight text-foreground">
            {costCenter.name}
          </span>
          {costCenter.owner?.fullName && (
            <span className="truncate text-xs text-muted-foreground leading-tight">
              {costCenter.owner.fullName}
            </span>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="ml-auto shrink-0 rounded-md p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus:opacity-100"
              aria-label={t`Actions`}
            >
              <LuEllipsisVertical className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onEdit(costCenter.id!)}>
              <LuPencil className="mr-2 size-4" />
              <Trans>Edit</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAddChild(costCenter.id!)}>
              <LuPlus className="mr-2 size-4" />
              <Trans>Add cost center</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(costCenter.id!)}
            >
              <LuTrash2 className="mr-2 size-4" />
              <Trans>Delete</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-transparent !border-0 !w-px !h-px !min-w-0 !min-h-0"
      />
    </div>
  );
}

export const CostCenterNode = memo(CostCenterNodeComponent);
