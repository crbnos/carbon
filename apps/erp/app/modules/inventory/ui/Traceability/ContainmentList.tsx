import { cn } from "@carbon/react";
import { LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import type { IssueContainment } from "./utils";

type Props = { items: IssueContainment[] };

export function ContainmentList({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y divide-border/30">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            to={path.to.issueDetails(item.id)}
            className="group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn(
                  "size-2 rounded-full shrink-0",
                  item.containmentStatus === "Uncontained"
                    ? "bg-red-500"
                    : "bg-amber-500"
                )}
              />
              <span className="text-sm font-medium truncate">
                {item.readableId ?? item.id.slice(0, 8)}
              </span>
              <span
                className={cn(
                  "text-[10px] uppercase tracking-wide font-medium shrink-0",
                  item.containmentStatus === "Uncontained"
                    ? "text-red-500"
                    : "text-amber-500"
                )}
              >
                {item.containmentStatus}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {item.priority && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {item.priority}
                </span>
              )}
              <LuExternalLink className="size-3 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
