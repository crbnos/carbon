import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import {
  LuArchive,
  LuCheck,
  LuEllipsisVertical,
  LuPencil,
  LuTrash2
} from "react-icons/lu";
import { Link } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { Budget } from "../../types";

const statusVariant = (status: Budget["status"]) => {
  switch (status) {
    case "Approved":
      return "green" as const;
    case "Archived":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
};

export function BudgetsTable({
  budgets,
  onEdit,
  onDelete,
  onApprove
}: {
  budgets: Budget[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onApprove: (id: string) => void;
}) {
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "accounting");
  const canDelete = permissions.can("delete", "accounting");

  return (
    <div className="bg-card overflow-hidden h-full">
      <div className="grid grid-cols-[1fr_120px_120px_auto] items-center border-b border-border bg-card h-11 px-6 gap-3">
        <span className="text-sm font-medium text-foreground/80">Budget</span>
        <span className="text-sm font-medium text-foreground/80">
          Fiscal Year
        </span>
        <span className="text-sm font-medium text-foreground/80">Status</span>
        <span className="text-sm font-medium text-foreground/80">Actions</span>
      </div>
      {budgets.map((budget) => (
        <div
          key={budget.id}
          className="grid grid-cols-[1fr_120px_120px_auto] items-center gap-3 border-b border-border px-6 py-3 transition-colors hover:bg-accent/50"
        >
          <div className="flex flex-col gap-0 min-w-0">
            <Link
              to={path.to.budget(budget.id)}
              className="text-sm font-medium text-foreground hover:underline truncate"
            >
              {budget.name}
            </Link>
            {budget.description && (
              <span className="text-xs text-muted-foreground truncate">
                {budget.description}
              </span>
            )}
          </div>
          <span className="text-sm text-foreground">{budget.fiscalYear}</span>
          <div>
            <Badge variant={statusVariant(budget.status)}>
              {budget.status}
            </Badge>
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
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  disabled={budget.status !== "Draft" || !canUpdate}
                  onClick={() => onEdit(budget.id)}
                >
                  <LuPencil className="mr-2 size-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={budget.status !== "Draft" || !canUpdate}
                  onClick={() => onApprove(budget.id)}
                >
                  <LuCheck className="mr-2 size-4" />
                  Approve
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={budget.status !== "Approved" || !canUpdate}
                  onClick={() => onApprove(budget.id)}
                >
                  <LuArchive className="mr-2 size-4" />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={budget.status !== "Draft" || !canDelete}
                  onClick={() => onDelete(budget.id)}
                >
                  <LuTrash2 className="mr-2 size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ))}
      {budgets.length === 0 && (
        <div className="px-6 py-10 text-sm text-muted-foreground">
          No budgets yet. Create one to start planning.
        </div>
      )}
    </div>
  );
}
