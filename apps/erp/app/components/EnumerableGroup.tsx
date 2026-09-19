import {
  Badge,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { Enumerable } from "./Enumerable";

type EnumerableGroupItem = {
  label: string;
  onClick?: () => void;
};

type EnumerableGroupProps = {
  items: EnumerableGroupItem[];
  limit?: number;
  // "enumerable" = colored entity chips; "outline" = readable-id badges,
  // matching how item ids render across the app.
  chip?: "enumerable" | "outline";
  chipClassName?: string;
};

// Single-line sibling of AvatarGroup for Enumerable chips: the first `limit`
// render inline and the rest collapse behind a +N chip that opens them (click,
// tap or keyboard — a hover card left touch and keyboard users out), so
// a list cell never wraps and every table row keeps the same height.
const EnumerableGroup = ({
  items,
  limit = 2,
  chip = "enumerable",
  chipClassName
}: EnumerableGroupProps) => {
  const { t } = useLingui();
  if (items.length === 0) return null;
  const visible = items.slice(0, limit);
  const overflow = items.slice(limit);

  const renderChip = (item: EnumerableGroupItem) =>
    chip === "outline" ? (
      <Badge
        key={item.label}
        variant="outline"
        onClick={item.onClick}
        title={item.label}
        className={cn(item.onClick && "cursor-pointer", chipClassName)}
      >
        {item.label}
      </Badge>
    ) : (
      <Enumerable
        key={item.label}
        value={item.label}
        onClick={item.onClick}
        className={cn(item.onClick && "cursor-pointer", chipClassName)}
      />
    );

  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      {visible.map(renderChip)}
      {overflow.length > 0 && (
        <Popover>
          <PopoverTrigger
            aria-label={t`Show ${overflow.length} more`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex min-h-[1.5rem] items-center rounded-md border bg-secondary px-2 text-[12px] font-bold tabular-nums text-secondary-foreground outline-none transition-colors hover:bg-secondary/80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            +{overflow.length}
          </PopoverTrigger>
          <PopoverContent className="w-auto max-w-[280px] p-2">
            <div className="flex flex-wrap items-center gap-2">
              {overflow.map(renderChip)}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
};

export { EnumerableGroup };
