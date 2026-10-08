// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Skeleton } from "@carbon/react";
import type { ReactNode } from "react";
import { LuChevronRight, LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";

/** A list of related documents in a `DocumentSidebar`, optionally titled. */
export function RelatedDocumentGroup({
  title,
  children
}: {
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      {title && (
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      )}
      <ul className="flex flex-col rounded-lg border bg-card divide-y overflow-hidden">
        {children}
      </ul>
    </section>
  );
}

type RelatedDocumentProps = {
  to: string;
  /** A file (a PDF, a label) rather than a page: opens in a new tab. */
  external?: boolean;
  icon: ReactNode;
  /** The document's readable id, or the file's name. */
  title: string;
  /** What it is, e.g. "Sales Order", or a short fact about it. */
  description?: ReactNode;
  status?: ReactNode;
};

const rowClassName =
  "group flex items-center gap-3 px-3 py-2.5 hover:bg-accent/30 focus-visible:bg-accent/30 focus-visible:outline-none transition-colors";

/** One related document: identity on the left, its status on the right. */
export function RelatedDocument({
  to,
  external = false,
  icon,
  title,
  description,
  status
}: RelatedDocumentProps) {
  const TrailingIcon = external ? LuExternalLink : LuChevronRight;
  const content = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-4">
        {icon}
      </span>
      <span className="flex flex-1 min-w-0 flex-col">
        <span className="w-full truncate whitespace-nowrap text-sm font-medium">
          {title}
        </span>
        {description && (
          <span className="w-full truncate text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {status && <span className="shrink-0">{status}</span>}
      <TrailingIcon className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" />
    </>
  );

  return (
    <li>
      {external ? (
        <a href={to} target="_blank" rel="noreferrer" className={rowClassName}>
          {content}
        </a>
      ) : (
        <Link to={to} className={rowClassName}>
          {content}
        </Link>
      )}
    </li>
  );
}

/** Placeholder rows while related documents stream in. */
export function RelatedDocumentSkeleton() {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Skeleton className="size-8 rounded-md" />
      <span className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3 w-16" />
      </span>
    </li>
  );
}
