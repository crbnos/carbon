// The page title block every hub surface opens with: H1 + intro lead, optional
// right-aligned aside (usually a <ProgressPill>). Feed `title`/`lead` from
// PAGE_COPY so the wording lives in the content layer.

import type { ReactNode } from "react";

export function PageHeader({
  title,
  lead,
  aside
}: {
  title: ReactNode;
  lead?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {lead != null ? (
          <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
            {lead}
          </p>
        ) : null}
      </div>
      {aside != null ? <div className="shrink-0">{aside}</div> : null}
    </header>
  );
}
