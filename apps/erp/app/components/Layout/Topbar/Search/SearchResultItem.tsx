import { cn } from "@carbon/react";
import { LuChevronRight } from "react-icons/lu";
import { getEntityTypeConfig, getEntityTypeLabel } from "./config";
import type { SearchResultItemProps } from "./types";

export function SearchResultItem({
  result,
  onSelect,
  searchQuery
}: SearchResultItemProps) {
  const config = getEntityTypeConfig(result.entityType);
  const Icon = config.icon;
  const entityLabel = getEntityTypeLabel(result.entityType);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left",
        "transition-colors duration-150",
        "hover:bg-accent focus:bg-accent focus:outline-none",
        "group cursor-pointer"
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
          config.bgColor || "bg-muted"
        )}
      >
        {Icon && (
          <Icon
            className={cn(
              "w-4 h-4",
              config.textColor || "text-muted-foreground"
            )}
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground truncate">
            <HighlightedText text={result.title} query={searchQuery} />
          </span>
        </div>
        {result.description && (
          <p className="text-sm text-muted-foreground truncate mt-0.5">
            {result.description}
          </p>
        )}
      </div>

      {/* Entity type label + chevron */}
      <div className="flex-shrink-0 flex items-center gap-2 text-muted-foreground">
        <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
          {entityLabel}
        </span>
        <LuChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  );
}

// Helper to highlight matching text
function HighlightedText({ text, query }: { text: string; query?: string }) {
  if (!query || query.length < 2) {
    return <>{text}</>;
  }

  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark
            key={i}
            className="bg-yellow-200 dark:bg-yellow-900/50 text-inherit rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
