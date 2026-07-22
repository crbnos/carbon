"use client";

/**
 * Checklist / Check — a stateful, tickable checklist. State persists per page
 * in localStorage; checked items strike through. Turns "read these N things"
 * into "did these N things".
 *
 * Usage in MDX:
 *   <Checklist>
 *     <Check>Item has an active revision</Check>
 *     <Check>Routing has at least one operation</Check>
 *   </Checklist>
 */
import { Children, cloneElement, isValidElement, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

export function Checklist({ children }: { children: ReactNode }) {
  let index = 0;
  return (
    <ul className="not-prose my-6 space-y-2">
      {Children.map(children, (child) =>
        isValidElement(child) ? cloneElement(child, { _index: index++ } as { _index: number }) : child,
      )}
    </ul>
  );
}

export function Check({ children, _index = 0 }: { children: ReactNode; _index?: number }) {
  const pathname = usePathname();
  const key = `carbon-docs:check:${pathname}:${_index}`;
  const [done, setDone] = useState(false);

  // Read persisted state after mount (avoids SSR/client mismatch).
  useEffect(() => {
    setDone(window.localStorage.getItem(key) === "1");
  }, [key]);

  function toggle() {
    const next = !done;
    setDone(next);
    window.localStorage.setItem(key, next ? "1" : "0");
  }

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={done}
        className="group flex w-full items-start gap-3 text-left"
      >
        <span
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
            done ? "border-brand bg-brand text-primary-foreground" : "border-border bg-card group-hover:border-brand/60"
          }`}
        >
          {done && (
            <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden>
              <path
                d="M3.5 8.5l3 3 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        <span
          className={`text-[15px] leading-relaxed ${
            done ? "text-muted-foreground line-through" : "text-foreground"
          }`}
        >
          {children}
        </span>
      </button>
    </li>
  );
}
