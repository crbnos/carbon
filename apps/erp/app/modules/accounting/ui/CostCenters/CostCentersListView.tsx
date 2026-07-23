import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuChevronRight,
  LuCircleDollarSign,
  LuEllipsisVertical,
  LuPencil,
  LuPlus,
  LuTrash2
} from "react-icons/lu";
import type { CostCenterTreeNode } from "../../types";

interface CostCentersListViewProps {
  costCenters: CostCenterTreeNode[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}

function CostCentersRow({
  costCenter,
  costCenters,
  depth,
  onEdit,
  onDelete,
  onAddChild
}: {
  costCenter: CostCenterTreeNode;
  costCenters: CostCenterTreeNode[];
  depth: number;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}) {
  const { t } = useLingui();
  const children = costCenters.filter(
    (c) => c.parentCostCenterId === costCenter.id
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
          <LuCircleDollarSign className="size-3.5 text-muted-foreground" />
        </div>

        <div className="flex flex-col gap-0 min-w-0">
          <span className="text-sm font-medium text-foreground">
            {costCenter.name}
          </span>
          {costCenter.owner?.fullName && (
            <span className="text-xs text-muted-foreground">
              {costCenter.owner.fullName}
            </span>
          )}
        </div>

        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={t`Actions`}
                icon={<LuEllipsisVertical />}
              />
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
      </div>

      {children.map((child) => (
        <CostCentersRow
          key={child.id}
          costCenter={child}
          costCenters={costCenters}
          depth={depth + 1}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  );
}

export function CostCentersListView({
  costCenters,
  onEdit,
  onDelete,
  onAddChild
}: CostCentersListViewProps) {
  const roots = costCenters.filter((c) => c.parentCostCenterId === null);

  return (
    <div className="bg-card overflow-hidden h-full">
      <div className="grid grid-cols-[1fr_auto] items-center border-b border-border bg-card h-11 px-6">
        <span className="text-sm font-medium text-foreground/80">
          <Trans>Cost Center</Trans>
        </span>
        <span className="text-sm font-medium text-foreground/80">
          <Trans>Actions</Trans>
        </span>
      </div>
      {roots.map((root) => (
        <CostCentersRow
          key={root.id}
          costCenter={root}
          costCenters={costCenters}
          depth={0}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  );
}
