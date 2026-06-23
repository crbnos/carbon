import type { ReactNode } from "react";

/* Editorial replacements for Fumadocs' default MDX Callout/Card, so the Reference
 * reads in the same warm-paper language as the Guide: cream callout boxes with a
 * mono badge, and warm cards with a hover arrow. Wired in via getMDXComponents. */

const toneClasses: Record<string, string> = {
  neutral: "border-ed-warm-400 bg-ed-warm-150 text-ed-ink/55",
  blue: "border-ed-blue-border bg-ed-blue-bg text-ed-blue-mid",
  green: "border-ed-green-border bg-ed-green-bg text-ed-green-text",
  amber: "border-ed-amber-stroke bg-ed-amber-fill text-ed-amber-text",
};

const calloutKinds: Record<string, { badge: string; tone: keyof typeof toneClasses }> = {
  info: { badge: "NOTE", tone: "blue" },
  note: { badge: "NOTE", tone: "blue" },
  warn: { badge: "HEADS UP", tone: "amber" },
  warning: { badge: "HEADS UP", tone: "amber" },
  error: { badge: "IMPORTANT", tone: "amber" },
  success: { badge: "GOOD TO KNOW", tone: "green" },
  tip: { badge: "TIP", tone: "green" },
};

export function Callout({
  type = "info",
  title,
  children,
}: {
  type?: string;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const kind = calloutKinds[type] ?? calloutKinds.info;
  return (
    <div className="my-8 callout-box p-2">
      <div className="w-full callout-box-inner px-5 py-4">
        <span
          className={`inline-flex items-center rounded-full border px-[7px] py-[3px] font-mono text-ed-10 leading-3 ${toneClasses[kind.tone]}`}
        >
          {kind.badge}
        </span>
        {title && (
          <p className="m-0 mt-2.5 text-ed-16 font-semi leading-[140%] text-ed-ink">{title}</p>
        )}
        <div className="m-0 mt-2 text-ed-14 font-book leading-[160%] text-ed-ink/72 [&>p]:m-0 [&>p+p]:mt-2.5">
          {children}
        </div>
      </div>
    </div>
  );
}

/* Plan gate marker — flags a feature that needs a paid plan. Carbon's gated
 * features (`packages/ee/src/plan.ts`) require the Business plan, so the badge reads
 * "Business plan" by default. Drop it at the top of a gated page, or right under the
 * heading of a gated section. */
export function PlanBadge({ plan = "Business", className = "" }: { plan?: string; className?: string }) {
  return (
    <span
      title={`Available on the ${plan} plan`}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-ed-amber-stroke bg-ed-amber-fill px-2.5 py-[3.5px] font-mono text-ed-10 font-semibold uppercase tracking-[0.04em] text-ed-amber-text ${className}`}
    >
      <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
        <rect x="2.6" y="6.3" width="8.8" height="5.6" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.5 6.3V4.7a2.5 2.5 0 0 1 5 0v1.6" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      Paid
    </span>
  );
}

export function Cards({ children }: { children?: ReactNode }) {
  return <div className="my-7 grid gap-3.5 sm:grid-cols-2">{children}</div>;
}

export function Card({
  title,
  href,
  icon,
  children,
}: {
  title?: ReactNode;
  href?: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <a
      href={href}
      className="group relative flex flex-col rounded-[14px] border border-ed-hairline bg-[linear-gradient(180deg,#FFFFFF_0%,#FBFBF8_100%)] px-[18px] py-[15px] no-underline shadow-[0_1px_2px_rgba(0,0,0,0.03),inset_0_1px_0_#fff] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-px hover:border-ed-warm-500 hover:shadow-[0_12px_28px_-16px_rgba(0,0,0,0.22)]"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && (
            <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-ed-hairline bg-white text-ed-ink/60 shadow-[inset_0_1px_0_#fff]">
              {icon}
            </span>
          )}
          <span className="truncate text-ed-15 font-semi tracking-[0.1px] text-ed-ink">{title}</span>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden
          className="mt-1 shrink-0 text-ed-ink/30 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-ed-ink/62"
        >
          <path
            d="M5.5 3.5L9 7l-3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {children && (
        // div, not p: MDX wraps the card's text child in its own <p>, so a <p> here
        // would nest <p><p> (hydration error). Re-apply the description styles to that
        // inner <p> so .prose's paragraph rules don't resize it.
        <div className="mt-[7px] text-ed-13 font-book leading-[155%] text-ed-ink/56 [&>p]:m-0 [&>p]:text-ed-13 [&>p]:font-book [&>p]:leading-[155%] [&>p]:text-ed-ink/56">
          {children}
        </div>
      )}
    </a>
  );
}

/* Field-style reference rows (env vars, parameters) — name · type · default ·
 * required badge, with a description beneath. Hairline-divided list. */
export function EnvVars({ children }: { children?: ReactNode }) {
  return (
    <div className="my-6 divide-y divide-ed-hairline border-y border-ed-hairline">{children}</div>
  );
}

export function EnvVar({
  name,
  type,
  default: defaultValue,
  required,
  children,
}: {
  name: string;
  type?: string;
  default?: string;
  required?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="py-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="font-mono text-ed-14 font-medium text-ed-ink">
          {name}
        </span>
        {type && (
          <span className="font-mono text-ed-12 text-ed-ink/45">
            {type}
          </span>
        )}
        {defaultValue != null && (
          <span className="font-mono text-ed-12 text-ed-ink/40">
            default: {defaultValue}
          </span>
        )}
        {required ? (
          <span className="inline-flex items-center rounded-[5px] border border-ed-amber-stroke bg-ed-amber-fill px-1.5 py-px text-ed-10 font-medium tracking-[0.02em] text-ed-amber-text">
            required
          </span>
        ) : (
          <span className="text-ed-11 text-ed-ink/38">optional</span>
        )}
      </div>
      {children && (
        <div className="mt-[7px] text-ed-14 leading-[155%] text-ed-ink/66 [&>p]:m-0 [&>p]:text-ed-14 [&>p]:leading-[155%] [&>p]:text-ed-ink/66 [&>p+p]:mt-2">
          {children}
        </div>
      )}
    </div>
  );
}
