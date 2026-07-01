import Link from "next/link";

/**
 * Rendered on table resource pages that have a companion view with computed
 * columns (e.g. salesInvoice → salesInvoices). Tells the reader to use the
 * view for reads and the table for writes.
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
        view instead. Use this table for <strong>create</strong>, <strong>update</strong>,
        and <strong>delete</strong> operations.
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
