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
import type { ReactNode } from "react";
import { getDefinitionText, getTermText, lookupEntry } from "@carbon/glossary";

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function Term({ id, children }: { id?: string; children: ReactNode }) {
  const key = id ?? (typeof children === "string" ? slugify(children) : "");
  const entry = lookupEntry(key);

  if (!entry) return <>{children}</>;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline cursor-help appearance-none border-0 bg-transparent p-0 m-0 [font:inherit] text-inherit align-baseline underline decoration-dotted decoration-ed-brand-ink decoration-[1.5px] underline-offset-[3.5px] transition-colors hover:decoration-ed-blue-text focus:outline-none focus-visible:outline-none focus-visible:rounded-[2px] focus-visible:ring-2 focus-visible:ring-ed-brand/50"
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
          className="z-50 w-75 max-w-[calc(100vw-32px)] rounded-[10px] border border-ed-warm-300 bg-white px-[15px] py-3.5 shadow-[0_4px_20px_rgba(38,35,35,0.10)]"
        >
          <div className="text-ed-13 font-medium text-ed-ink">
            {getTermText(entry)}
          </div>
          <div className="mt-[5px] text-ed-13 leading-[1.55] text-ed-ink/72">
            {getDefinitionText(entry)}
          </div>
          {entry.href && (
            <div className="mt-[11px] border-t border-ed-warm-150 pt-2.5">
              <Popover.Close asChild>
                <Link
                  href={entry.href}
                  className="inline-flex items-center gap-1 text-ed-13 font-medium text-ed-brand-ink no-underline hover:text-ed-blue-text"
                >
                  Learn more
                  <span aria-hidden>→</span>
                </Link>
              </Popover.Close>
            </div>
          )}
          <Popover.Arrow width={12} height={6} className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
