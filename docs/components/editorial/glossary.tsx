import Link from "next/link";
import {
  getDefinitionText,
  getTermText,
  glossaryEntries,
  termSlug
} from "@carbon/glossary";

/**
 * Glossary — the whole `lib/glossary.ts` rendered as one reference page, in the
 * same hairline "environment list" language as <EnvVars>. Sourced directly from the
 * glossary object so the inline <Term> popovers, this page, and the search index can
 * never drift: add a term once in lib/glossary.ts and it shows up everywhere.
 *
 * Entries are deduped (aliases share one term) and grouped by first letter for
 * scannability; "8D" and any other digit-leading term fall under "#". Each row carries
 * an anchor id (termSlug) so a search hit can deep-link straight to the term.
 */
export function Glossary() {
  const entries = glossaryEntries();

  // Group into alphabetical sections (digits → "#").
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const first = getTermText(entry)[0]?.toUpperCase() ?? "#";
    const letter = /[A-Z]/.test(first) ? first : "#";
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(entry);
  }

  return (
    <div className="my-7">
      {[...groups.entries()].map(([letter, items]) => (
        <section key={letter} className="mb-7">
          <h2
            id={`letter-${letter.toLowerCase()}`}
            className="!mt-0 !mb-1.5 scroll-mt-22 !border-0 font-mono !text-ed-12 !font-semibold uppercase tracking-[0.08em] !text-ed-ink/40"
          >
            {letter}
          </h2>
          <div className="divide-y divide-ed-hairline border-y border-ed-hairline">
            {items.map((entry) => {
              const term = getTermText(entry);
              return (
                <div key={term} id={termSlug(term)} className="scroll-mt-22 py-[15px]">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-[3px]">
                    <span className="text-ed-15 font-semi text-ed-ink">{term}</span>
                    {entry.href && (
                      <Link
                        href={entry.href}
                        className="shrink-0 text-ed-12 font-medium text-ed-brand-ink no-underline hover:text-ed-blue-text"
                      >
                        Learn more <span aria-hidden>→</span>
                      </Link>
                    )}
                  </div>
                  <p className="m-0 mt-[5px] text-ed-14 leading-[155%] text-ed-ink/66">
                    {getDefinitionText(entry)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
