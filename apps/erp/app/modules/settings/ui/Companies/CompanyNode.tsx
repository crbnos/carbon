import { CountryFlag } from "@carbon/form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@carbon/react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import {
  LuBuilding2,
  LuEllipsisVertical,
  LuPlus,
  LuTrash2
} from "react-icons/lu";
import type { Country } from "react-phone-number-input";
import type { Company } from "../../types";

interface CompanyNodeData extends Record<string, unknown> {
  company: Company;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}

function CompanyNodeComponent({ data }: NodeProps & { data: CompanyNodeData }) {
  const { company, onDelete, onAddChild } = data;
  const isElimination = company.isEliminationEntity;

  return (
    // pointer-events-auto: the flow marks non-interactive nodes (not
    // selectable/draggable/connectable) as `pointer-events: none`, which
    // otherwise swallows hover + clicks on the actions menu below.
    <div className="group relative pointer-events-auto">
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-transparent !border-0 !w-px !h-px !min-w-0 !min-h-0"
      />

      <div
        className={`
          flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-sm
          transition-shadow hover:shadow-md
          ${isElimination ? "border-dashed border-muted-foreground/30" : "border-border"}
        `}
        // Fixed width matches the dimensions dagre lays out with
        // (see layout-utils), so the top/bottom handles sit at the node's
        // true center and edges connect cleanly.
        style={{ width: isElimination ? 160 : 200 }}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          {company.countryCode && !isElimination ? (
            <CountryFlag
              countryCode={company.countryCode as Country}
              className="flex h-5 w-7 overflow-hidden rounded-sm"
            />
          ) : (
            <LuBuilding2 className="size-4 text-muted-foreground" />
          )}
        </div>

        <div className="flex flex-col gap-0.5 overflow-hidden min-w-0">
          <span
            className={`truncate text-sm font-medium leading-tight ${
              isElimination ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {company.name}
          </span>
          <span className="text-xs text-muted-foreground leading-tight truncate">
            {company.baseCurrencyCode}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="ml-auto shrink-0 rounded-md p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus:opacity-100"
              aria-label="Actions"
            >
              <LuEllipsisVertical className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {!isElimination && (
              <DropdownMenuItem onClick={() => onAddChild(company.id!)}>
                <LuPlus className="mr-2 size-4" />
                Add company
              </DropdownMenuItem>
            )}

            {company.parentCompanyId && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(company.id!)}
              >
                <LuTrash2 className="mr-2 size-4" />
                Delete
              </DropdownMenuItem>
            )}
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

export const CompanyNode = memo(CompanyNodeComponent);
