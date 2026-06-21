"use client";

/**
 * Term — an inline glossary term. Dotted blue underline (distinct from a real link,
 * which is solid + blue text); click/tap opens a popover with a grounded definition
 * and, when the term has a home page, a "Learn more" link.
 *
 * Usage in MDX:
 *   <Term>purchase to order</Term>                 — text is slugified to find the entry
 *   <Term id="purchase-to-order">bought</Term>     — explicit key when display ≠ term
 *
 * An unknown key renders the text plainly — a glossary gap never breaks prose or
 * leaves a dotted underline that opens nothing.
 */
import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { glossary } from "@/lib/glossary";

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function Term({ id, children }: { id?: string; children: ReactNode }) {
  const pathname = usePathname();
  const key = id ?? (typeof children === "string" ? slugify(children) : "");
  const entry = glossary[key];

  if (!entry) return <>{children}</>;

  // Hide "Learn more" when it points at the page you're already on — a link back to
  // here is noise. Compare path only (ignore hash + trailing slash).
  const hrefPath = entry.href?.split("#")[0].replace(/\/$/, "");
  const showLearnMore = !!hrefPath && hrefPath !== (pathname ?? "").replace(/\/$/, "");

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline cursor-help appearance-none border-0 bg-transparent p-0 m-0 [font:inherit] text-inherit align-baseline underline decoration-dotted decoration-[#1E84B0] decoration-[1.5px] underline-offset-[3.5px] transition-colors hover:decoration-[#0C6E96] focus:outline-none focus-visible:outline-none focus-visible:rounded-[2px] focus-visible:ring-2 focus-visible:ring-[#00B0FF]/50"
        >
          {children}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-[300px] max-w-[calc(100vw-32px)] rounded-[10px] border border-[#E3E3DF] bg-white px-[15px] py-[14px] shadow-[0_4px_20px_rgba(38,35,35,0.10)]"
        >
          <div className="text-[13px] font-[500] text-[#262323]">{entry.term}</div>
          <div className="mt-[5px] text-[13px] leading-[1.55] text-[rgba(38,35,35,0.72)]">
            {entry.definition}
          </div>
          {showLearnMore && (
            <div className="mt-[11px] border-t border-[#EFEFEB] pt-[10px]">
              <Link
                href={entry.href}
                className="inline-flex items-center gap-[4px] text-[13px] font-[500] text-[#1E84B0] no-underline hover:text-[#0C6E96]"
              >
                Learn more
                <span aria-hidden>→</span>
              </Link>
            </div>
          )}
          <Popover.Arrow width={12} height={6} className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
