import { Popover, PopoverContent, PopoverTrigger } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuInfo, LuLoaderCircle } from "react-icons/lu";
import { useFetcher } from "react-router";
import { AREA_LABELS, BACKUP_SUMMARY_GROUPS } from "../../backups.areas";

// "i" popover with a compact table of how much of what a backup carries.
// Counts are lazy-loaded (head counts per entity) the first time it opens; the
// API returns area keys and per-table counts, and the labels resolve here.
export function BackupContentsInfo() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const summary = useFetcher<{
    groups: { area: string; rows: { table: string; count: number }[] }[];
    total: number;
  }>();
  const loaded = summary.data !== undefined;
  const loading = summary.state === "loading";

  const countOf = (area: string, table: string) =>
    summary.data?.groups
      .find((g) => g.area === area)
      ?.rows.find((r) => r.table === table)?.count ?? 0;

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
          aria-label={t`What a backup contains`}
          className="text-muted-foreground hover:text-foreground"
        >
          <LuInfo className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 max-h-[60dvh] overflow-y-auto"
      >
        <p className="text-sm font-medium">
          <Trans>What's in a backup</Trans>
        </p>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          <Trans>
            Every company-scoped record. Credentials, integration tokens and
            webhooks are never included.
          </Trans>
        </p>

        {loading && !loaded ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <LuLoaderCircle className="h-3.5 w-3.5 animate-spin" />
            <Trans>Counting…</Trans>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {BACKUP_SUMMARY_GROUPS.filter((group) =>
              group.entities.some(([, table]) => countOf(group.area, table) > 0)
            ).map((group) => (
              <div key={group.area} className="flex flex-col gap-0.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(AREA_LABELS[group.area])}
                </p>
                {group.entities
                  .filter(([, table]) => countOf(group.area, table) > 0)
                  .map(([label, table]) => (
                    <div
                      key={table}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-foreground">{t(label)}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {countOf(group.area, table).toLocaleString()}
                      </span>
                    </div>
                  ))}
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-2 text-xs font-medium">
              <span>
                <Trans>Total records</Trans>
              </span>
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
