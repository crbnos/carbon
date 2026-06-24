import { Popover, PopoverContent, PopoverTrigger } from "@carbon/react";
import { useState } from "react";
import { LuInfo, LuLoaderCircle } from "react-icons/lu";
import { useFetcher } from "react-router";

// "i" popover with a compact table of how much of what a backup carries.
// Counts are lazy-loaded (head counts per entity) the first time it opens.
export function BackupContentsInfo() {
  const [open, setOpen] = useState(false);
  const summary = useFetcher<{
    groups: { title: string; rows: { label: string; count: number }[] }[];
    total: number;
  }>();
  const loaded = summary.data !== undefined;
  const loading = summary.state === "loading";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && !loaded && summary.state === "idle") {
          summary.load("/api/settings/backup-summary");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="What a backup contains"
          className="text-muted-foreground hover:text-foreground"
        >
          <LuInfo className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 max-h-[60dvh] overflow-y-auto"
      >
        <p className="text-sm font-medium">What's in a backup</p>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          Every company-scoped record. Credentials, integration tokens and
          webhooks are never included.
        </p>

        {loading && !loaded ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <LuLoaderCircle className="h-3.5 w-3.5 animate-spin" />
            Counting…
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {summary.data?.groups
              .filter((g) => g.rows.some((r) => r.count > 0))
              .map((group) => (
                <div key={group.title} className="flex flex-col gap-0.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {group.title}
                  </p>
                  {group.rows
                    .filter((r) => r.count > 0)
                    .map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-foreground">{row.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {row.count.toLocaleString()}
                        </span>
                      </div>
                    ))}
                </div>
              ))}
            <div className="flex items-center justify-between border-t pt-2 text-xs font-medium">
              <span>Total records</span>
              <span className="tabular-nums">
                {(summary.data?.total ?? 0).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
