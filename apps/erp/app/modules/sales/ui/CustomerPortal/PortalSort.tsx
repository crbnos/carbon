import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import { LuArrowDown, LuArrowUp, LuArrowUpDown } from "react-icons/lu";
import { useUrlParams } from "~/hooks";

export type SortableColumn = { value: string; label: string };

function parseSort(value: string | undefined) {
  const match = value?.match(/^(.+):(asc|desc)$/);
  if (!match) return null;
  return { column: match[1], direction: match[2] as "asc" | "desc" };
}

export function PortalSort({ columns }: { columns: SortableColumn[] }) {
  const [params, setParams] = useUrlParams();
  const current = parseSort(params.get("sort") ?? undefined);

  const setSort = (column: string, direction: "asc" | "desc") => {
    setParams({ sort: [`${column}:${direction}`] });
  };
  const clearSort = () => setParams({ sort: [] });
  const flipDirection = () => {
    if (!current) return;
    setSort(current.column, current.direction === "asc" ? "desc" : "asc");
  };

  const activeLabel = current
    ? (columns.find((c) => c.value === current.column)?.label ?? current.column)
    : null;

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<LuArrowUpDown />}
            className="font-medium"
          >
            {activeLabel ? (
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Sort:</span>
                <span>{activeLabel}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Sort by…</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuRadioGroup value={current?.column ?? ""}>
            {columns.map((col) => (
              <DropdownMenuRadioItem
                key={col.value}
                value={col.value}
                onClick={() => setSort(col.value, current?.direction ?? "asc")}
              >
                {col.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {current && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={clearSort}
                className="text-muted-foreground"
              >
                <LuArrowUpDown className="mr-2 size-4" />
                Clear sort
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton
        aria-label={
          current?.direction === "desc"
            ? "Switch to ascending"
            : "Switch to descending"
        }
        title={
          current?.direction === "desc"
            ? "Switch to ascending"
            : "Switch to descending"
        }
        size="sm"
        variant={current ? "secondary" : "ghost"}
        disabled={!current}
        onClick={flipDirection}
        icon={
          current?.direction === "desc" ? (
            <LuArrowDown />
          ) : current?.direction === "asc" ? (
            <LuArrowUp />
          ) : (
            <LuArrowUpDown />
          )
        }
      />
    </div>
  );
}
