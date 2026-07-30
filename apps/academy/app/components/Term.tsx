import {
  getDefinitionText,
  getTermText,
  lookupEntry,
  termSlug
} from "@carbon/glossary";
import { Popover, PopoverContent, PopoverTrigger } from "@carbon/react";
import type { ReactNode } from "react";

/**
 * Inline glossary term — dotted blue underline; click opens a popover with the
 * definition. Reads the source English (academy has no Lingui runtime, like the
 * docs site). An unknown slug renders the children plainly, so a glossary gap
 * never breaks prose.
 */
export function Term({ id, children }: { id?: string; children: ReactNode }) {
  const key = id ?? (typeof children === "string" ? termSlug(children) : "");
  const entry = lookupEntry(key);

  if (!entry) return <>{children}</>;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline cursor-help appearance-none border-0 bg-transparent p-0 align-baseline [font:inherit] text-inherit underline decoration-ed-brand-ink decoration-dotted decoration-[1.5px] underline-offset-[3.5px] transition-colors hover:decoration-ed-blue-text focus:outline-none"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="w-75 max-w-[calc(100vw-32px)] rounded-[10px] border border-ed-warm-300 bg-white px-[15px] py-3.5 shadow-[0_4px_20px_rgba(38,35,35,0.10)]"
      >
        <div className="text-ed-13 font-demi text-ed-ink">
          {getTermText(entry)}
        </div>
        <div className="mt-[5px] text-ed-13 leading-[1.55] text-ed-ink/72">
          {getDefinitionText(entry)}
        </div>
      </PopoverContent>
    </Popover>
  );
}
