import { CountryFlag } from "@carbon/form";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import { useState } from "react";
import {
  LuBuilding2,
  LuChevronRight,
  LuEllipsisVertical,
  LuPlus,
  LuTrash2
} from "react-icons/lu";
import type { Country } from "react-phone-number-input";
import type { Company } from "../../types";

interface CompaniesListViewProps {
  companies: Company[];
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}

function CompaniesRow({
  company,
  companies,
  depth,
  onDelete,
  onAddChild
}: {
  company: Company;
  companies: Company[];
  depth: number;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}) {
  const children = companies.filter((s) => s.parentCompanyId === company.id);
  const hasChildren = children.length > 0;
  const [expanded, setExpanded] = useState(true);
  const isElimination = company.isEliminationEntity;
  const canAddChild = !isElimination;
  const canDelete = !!company.parentCompanyId;
  const hasActions = canAddChild || canDelete;

  return (
    <div>
      <div
        className="flex items-center gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-accent/50"
        style={{ paddingLeft: `${depth * 28 + 16}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
          >
            <LuChevronRight
              className={cn(
                "size-4 transition-transform",
                expanded && "rotate-90"
              )}
            />
          </button>
        ) : (
          <div className="size-4 shrink-0" />
        )}

        <div className="flex size-8 shrink-0 items-center justify-center bg-muted">
          {company.countryCode && !isElimination ? (
            <CountryFlag
              countryCode={company.countryCode as Country}
              className="flex h-4 w-6 overflow-hidden rounded-sm"
            />
          ) : (
            <LuBuilding2 className="size-3.5 text-muted-foreground" />
          )}
        </div>

        <div className="flex flex-col gap-0 min-w-0">
          <span
            className={`text-sm font-medium ${
              isElimination ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {company.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {company.baseCurrencyCode}
          </span>
        </div>

        {hasActions && (
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
                {canAddChild && (
                  <DropdownMenuItem onClick={() => onAddChild(company.id!)}>
                    <LuPlus className="mr-2 size-4" />
                    Add company
                  </DropdownMenuItem>
                )}
                {canDelete && (
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
        )}
      </div>

      {hasChildren &&
        expanded &&
        children.map((child) => (
          <CompaniesRow
            key={child.id}
            company={child}
            companies={companies}
            depth={depth + 1}
            onDelete={onDelete}
            onAddChild={onAddChild}
          />
        ))}
    </div>
  );
}

export function CompaniesListView({
  companies,
  onDelete,
  onAddChild
}: CompaniesListViewProps) {
  const roots = companies.filter((s) => s.parentCompanyId === null);

  return (
    <div className="bg-card overflow-hidden">
      <div className="grid grid-cols-[1fr_auto] items-center border-b border-border bg-card h-11 px-6">
        <span className="text-sm font-medium text-foreground/80">Company</span>
        <span className="text-sm font-medium text-foreground/80">Actions</span>
      </div>
      {roots.map((root) => (
        <CompaniesRow
          key={root.id}
          company={root}
          companies={companies}
          depth={0}
          onDelete={onDelete}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  );
}
