/**
 * FeatureCallout — the two-column "bridge to product" card. Left: the
 * explanation + a CTA. Right: a muted aside. Use whenever a concept maps to a
 * direct action in Carbon. Server component (no client JS needed).
 *
 * Usage in MDX:
 *   <FeatureCallout title="Try in Carbon" href="https://app.carbon.ms"
 *     cta="Open the routing builder →" aside="Templated per item revision.">
 *   Lay out operations and assign each to a work center...
 *   </FeatureCallout>
 */
import Link from "next/link";
import type { ReactNode } from "react";

export function FeatureCallout({
  title = "Try in Carbon",
  href,
  cta = "Open Carbon →",
  aside,
  children,
}: {
  title?: string;
  href?: string;
  cta?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="not-prose my-8 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="grid gap-6 sm:grid-cols-[1fr_minmax(0,12rem)]">
        <div>
          <div className="mb-3 flex items-center justify-between gap-4">
            <span className="inline-flex items-center rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">
              {title}
            </span>
            {href && (
              <Link
                href={href}
                className="inline-flex shrink-0 items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {cta}
              </Link>
            )}
          </div>
          <div className="text-[15px] leading-relaxed text-foreground [&>p]:m-0">{children}</div>
        </div>

        {aside && (
          <p className="text-xs leading-relaxed text-muted-foreground sm:border-l sm:border-border sm:pl-5">
            {aside}
          </p>
        )}
      </div>
    </div>
  );
}
