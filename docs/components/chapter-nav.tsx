"use client";

/**
 * ChapterNav — the editorial Guide sidebar: roman-numeral chapters, each a
 * vertical line of connected step-dots. The current step is filled with the
 * brand accent; completed steps are solid foreground; upcoming steps hollow.
 *
 * Reads as a *journey*, not a file tree. Mount in the Guide layout.
 *
 * The `chapters` prop should be derived from the Fumadocs page tree so it stays
 * in sync with meta.json (one source of truth). In your Guide layout:
 *
 *   import { source } from "@/lib/source";
 *   // walk source.pageTree: folders → chapters, pages → steps {title, url}
 *   <ChapterNav chapters={chapters} title="How to run your shop with Carbon" />
 *
 * Keeping it presentational (chapters passed in) makes it trivial to test and
 * avoids coupling to a specific Fumadocs tree shape.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export type Step = { title: string; url: string };
export type Chapter = { label: string; steps: Step[] };

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function dotClass(state: "active" | "done" | "todo") {
  if (state === "active") return "bg-brand";
  if (state === "done") return "bg-foreground";
  return "border border-border bg-transparent";
}

export function ChapterNav({
  chapters,
  title = "How to run your shop with Carbon",
}: {
  chapters: Chapter[];
  title?: string;
}) {
  const pathname = usePathname();

  const flat = chapters.flatMap((c) => c.steps);
  const activeIndex = flat.findIndex((s) => s.url === pathname);

  let i = -1; // running index across all steps

  return (
    <nav className="text-sm">
      <p className="mb-6 max-w-[14rem] text-ed-13 leading-snug text-muted-foreground">{title}</p>

      <ol className="space-y-7">
        {chapters.map((chapter, ci) => (
          <li key={chapter.label}>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="font-mono text-xs text-muted-foreground">{ROMAN[ci] ?? ci + 1}.</span>
              <span className="font-medium text-foreground">{chapter.label}</span>
            </div>

            <ul className="ml-1 space-y-0.5 border-l border-border pl-4">
              {chapter.steps.map((step) => {
                i += 1;
                const state =
                  i === activeIndex ? "active" : activeIndex !== -1 && i < activeIndex ? "done" : "todo";

                return (
                  <li key={step.url} className="relative">
                    <span
                      aria-hidden
                      className={`absolute -left-[1.3rem] top-2 size-2 rounded-full ring-2 ring-[hsl(var(--background))] ${dotClass(
                        state,
                      )}`}
                    />
                    <Link
                      href={step.url}
                      aria-current={state === "active" ? "page" : undefined}
                      className={`block rounded-md px-2 py-1 transition-colors ${
                        state === "active"
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {step.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </nav>
  );
}
