import Link from "next/link";

/**
 * Rendered at the top of every table resource page: the Data API can write
 * straight to this table, but doing so skips the service layer, so derived
 * values aren't recalculated. Steer writes to the Carbon API.
 */
export function WriteSteerCallout() {
  return (
    <div className="my-5 rounded-xl border border-ed-amber-stroke/70 bg-ed-amber-fill px-4 py-3.5">
      <p className="m-0 text-ed-14 font-semi text-ed-amber-text">
        Writes belong on the Carbon API
      </p>
      <p className="m-0 mt-1 text-ed-14 leading-[155%] text-ed-ink/78">
        Writing to this table over the Data API skips the service layer, so
        Carbon won't recalculate the values that depend on it — totals,
        statuses, ledger entries. For creates and updates use the{" "}
        <Link
          href="/api"
          className="font-medium text-ed-brand-ink underline decoration-ed-blue-border underline-offset-2 hover:decoration-ed-brand-ink"
        >
          Carbon API
        </Link>
        ; treat the Data API as read-mostly.
      </p>
    </div>
  );
}

/**
 * Rendered on table resource pages that have a companion view with computed
 * columns (e.g. salesInvoice → salesInvoices). Tells the reader to read from
 * the view for accurate computed values.
 */
export function ViewCallout({
  tableName,
  viewName,
  viewHref,
}: {
  tableName: string;
  viewName: string;
  viewHref: string;
}) {
  return (
    <div className="my-5 rounded-xl border border-ed-blue-border/60 bg-ed-blue-surface px-4 py-3.5">
      <p className="m-0 text-ed-14 font-semi text-ed-brand-ink">
        Use the view for reads
      </p>
      <p className="m-0 mt-1 text-ed-14 leading-[155%] text-ed-ink/78">
        The <code className="font-mono text-ed-13 text-ed-brown">{tableName}</code> table
        has stored total and status columns that may be stale. For accurate computed
        values (totals, tax, balance, status), read from the{" "}
        <Link
          href={viewHref}
          className="font-medium text-ed-brand-ink underline decoration-ed-blue-border underline-offset-2 hover:decoration-ed-brand-ink"
        >
          {viewName}
        </Link>{" "}
        view instead.
      </p>
    </div>
  );
}

/**
 * Rendered on view resource pages that are the "read" companion to a table.
 */
export function TableCallout({
  tableName,
  tableHref,
}: {
  tableName: string;
  tableHref: string;
}) {
  return (
    <div className="my-5 rounded-xl border border-ed-hairline bg-ed-warm-50 px-4 py-3.5">
      <p className="m-0 text-ed-14 font-semi text-ed-ink/80">
        Read-only view
      </p>
      <p className="m-0 mt-1 text-ed-14 leading-[155%] text-ed-ink/78">
        This view returns computed totals, tax, balance, and status derived from line
        items and settlements — use it for all reads. To create, update, or delete
        records, use the{" "}
        <Link
          href={tableHref}
          className="font-medium text-ed-brand-ink underline decoration-ed-blue-border underline-offset-2 hover:decoration-ed-brand-ink"
        >
          {tableName}
        </Link>{" "}
        table.
      </p>
    </div>
  );
}
