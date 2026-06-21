import type { ReactNode } from "react";

/* Editorial replacements for Fumadocs' default MDX Callout/Card, so the Reference
 * reads in the same warm-paper language as the Guide: cream callout boxes with a
 * mono badge, and warm cards with a hover arrow. Wired in via getMDXComponents. */

const toneClasses: Record<string, string> = {
  neutral: "border-[#DADAD5] bg-[#EFEFEB] text-[rgba(38,35,35,0.55)]",
  blue: "border-[#A9DAF3] bg-[#DFF5FF] text-[#3583A8]",
  green: "border-[#A8DB91] bg-[#E4F8DA] text-[#4F9140]",
  amber: "border-[#E6CFA3] bg-[#FFF2D8] text-[#9C7136]",
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
    <div className="my-[32px] callout-box p-[8px]">
      <div className="w-full callout-box-inner px-[20px] py-[16px]">
        <span
          className={`inline-flex items-center rounded-[100px] border px-[7px] py-[3px] font-[family-name:var(--font-mono)] text-[10px] leading-[12px] ${toneClasses[kind.tone]}`}
        >
          {kind.badge}
        </span>
        {title && (
          <p className="m-0 mt-[10px] text-[16px] font-[560] leading-[140%] text-[#262323]">{title}</p>
        )}
        <div className="m-0 mt-[8px] text-[14.5px] font-[460] leading-[160%] text-[rgba(38,35,35,0.72)] [&>p]:m-0 [&>p+p]:mt-[10px]">
          {children}
        </div>
      </div>
    </div>
  );
}

/* Plan gate marker — flags a feature that needs a paid plan. Carbon's gated
 * features (`packages/ee/src/plan.ts`) all require the Business or Partner plan, so
 * the badge reads "Business plan" by default. Drop it at the top of a gated page, or
 * right under the heading of a gated section. */
export function PlanBadge({ plan = "Business", className = "" }: { plan?: string; className?: string }) {
  return (
    <span
      title={`Available on the ${plan} and Partner plans`}
      className={`inline-flex items-center gap-[6px] whitespace-nowrap rounded-[100px] border border-[#E6CFA3] bg-[#FFF2D8] px-[10px] py-[3.5px] font-[family-name:var(--font-mono)] text-[10.5px] font-[600] uppercase tracking-[0.04em] text-[#9C7136] ${className}`}
    >
      <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
        <rect x="2.6" y="6.3" width="8.8" height="5.6" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.5 6.3V4.7a2.5 2.5 0 0 1 5 0v1.6" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      {plan} plan
    </span>
  );
}

export function Cards({ children }: { children?: ReactNode }) {
  return <div className="my-[28px] grid gap-[14px] sm:grid-cols-2">{children}</div>;
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
      className="group relative flex flex-col rounded-[14px] border border-[#E7E7E3] bg-[linear-gradient(180deg,#FFFFFF_0%,#FBFBF8_100%)] px-[18px] py-[15px] no-underline shadow-[0_1px_2px_rgba(0,0,0,0.03),inset_0_1px_0_#fff] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-px hover:border-[#D2D2CC] hover:shadow-[0_12px_28px_-16px_rgba(0,0,0,0.22)]"
    >
      <div className="flex items-start justify-between gap-[10px]">
        <div className="flex min-w-0 items-center gap-[10px]">
          {icon && (
            <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] border border-[#E7E7E3] bg-white text-[rgba(38,35,35,0.6)] shadow-[inset_0_1px_0_#fff]">
              {icon}
            </span>
          )}
          <span className="truncate text-[15px] font-[560] tracking-[0.1px] text-[#262323]">{title}</span>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden
          className="mt-[4px] shrink-0 text-[rgba(38,35,35,0.3)] transition-all duration-200 group-hover:translate-x-[2px] group-hover:text-[rgba(38,35,35,0.62)]"
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
        <div className="mt-[7px] text-[13.5px] font-[450] leading-[155%] text-[rgba(38,35,35,0.56)] [&>p]:m-0 [&>p]:text-[13.5px] [&>p]:font-[450] [&>p]:leading-[155%] [&>p]:text-[rgba(38,35,35,0.56)]">
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
    <div className="my-[24px] divide-y divide-[#E7E7E3] border-y border-[#E7E7E3]">{children}</div>
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
    <div className="py-[16px]">
      <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <span className="font-[family-name:var(--font-mono)] text-[14px] font-[500] text-[#262323]">
          {name}
        </span>
        {type && (
          <span className="font-[family-name:var(--font-mono)] text-[12px] text-[rgba(38,35,35,0.45)]">
            {type}
          </span>
        )}
        {defaultValue != null && (
          <span className="font-[family-name:var(--font-mono)] text-[12px] text-[rgba(38,35,35,0.4)]">
            default: {defaultValue}
          </span>
        )}
        {required ? (
          <span className="inline-flex items-center rounded-[5px] border border-[#E6CFA3] bg-[#FFF2D8] px-[6px] py-[1px] text-[10.5px] font-medium tracking-[0.02em] text-[#9C7136]">
            required
          </span>
        ) : (
          <span className="text-[11px] text-[rgba(38,35,35,0.38)]">optional</span>
        )}
      </div>
      {children && (
        <div className="mt-[7px] text-[14px] leading-[155%] text-[rgba(38,35,35,0.66)] [&>p]:m-0 [&>p]:text-[14px] [&>p]:leading-[155%] [&>p]:text-[rgba(38,35,35,0.66)] [&>p+p]:mt-[8px]">
          {children}
        </div>
      )}
    </div>
  );
}
