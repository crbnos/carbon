import { Popover, PopoverContent, PopoverTrigger } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuInfo } from "react-icons/lu";

export type ExcludedRow = {
  table: string;
  column: string;
  refTable: string;
  rows: number;
  /** Absent on a failure marker's violations (all are direct violations). */
  cause?: "violation" | "cascade";
};

// "i" popover listing the exact table.column → refTable edges behind a
// "rows excluded" line or a failed-backup banner, so support can act on them.
// Product words live in the row's own line; exact names and the raw error live
// here (copy rule D9 of the backup spec).
export function ExcludedRowsInfo({
  excludedRows,
  title,
  description,
  technical
}: {
  excludedRows: ExcludedRow[];
  title?: ReactNode;
  description?: ReactNode;
  /** The job's raw error text, for support — shown under the rows. */
  technical?: string | null;
}) {
  const { t } = useLingui();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t`Details`}
          className="inline-flex align-middle text-muted-foreground hover:text-foreground"
        >
          <LuInfo className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-h-[60dvh] overflow-y-auto"
      >
        <p className="text-sm font-medium">
          {title ?? <Trans>Rows left out of this backup</Trans>}
        </p>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          {description ?? (
            <Trans>
              These rows link to data outside this company, so they could never
              be restored. Everything else was backed up.
            </Trans>
          )}
        </p>
        <div className="flex flex-col gap-1.5">
          {excludedRows.map((e) => (
            <div
              key={`${e.table}.${e.column}.${e.cause ?? ""}`}
              className="flex items-start justify-between gap-3 text-xs"
            >
              <div className="flex flex-col min-w-0">
                <span className="font-mono text-foreground break-all">
                  {e.table}.{e.column} → {e.refTable}
                </span>
                {e.cause ? (
                  <span className="text-muted-foreground">
                    {e.cause === "violation"
                      ? t`link outside company`
                      : t`depends on an excluded row`}
                  </span>
                ) : null}
              </div>
              <span className="tabular-nums text-muted-foreground shrink-0">
                {e.rows.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        {technical ? (
          <details className="mt-3 border-t pt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              <Trans>Technical details</Trans>
            </summary>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
              {technical}
            </pre>
          </details>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
