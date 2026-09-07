import { Badge } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { Link } from "react-router";
import { Empty } from "~/components";
import type { ListPayload } from "../dashboard.models";

/** Up to eight rows styled like the home page's Recent list. */
export function ListWidget({ payload }: { payload: ListPayload }) {
  const { locale } = useLocale();
  if (payload.rows.length === 0) {
    return <Empty className="h-40" />;
  }
  return (
    <div className="flex flex-col gap-2">
      {payload.rows.map((row) => (
        <Link
          key={row.id}
          to={row.to}
          prefetch="intent"
          className="flex items-center gap-3 px-3 py-2 bg-muted/20 rounded-lg border border-border hover:border-foreground/20 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium tracking-tight truncate">
              {row.title}
            </div>
            {row.subtitle ? (
              <div className="text-xs text-muted-foreground truncate">
                {row.subtitle}
              </div>
            ) : null}
          </div>
          {row.status ? (
            <Badge variant="secondary" className="shrink-0">
              {row.status}
            </Badge>
          ) : null}
          {row.date ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatDate(
                row.date.slice(0, 10),
                { month: "short", day: "numeric" },
                locale
              )}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
