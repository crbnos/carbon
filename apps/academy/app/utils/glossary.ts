import { getTermText, listEntries } from "@carbon/glossary";

export type GlossarySegment = string | { text: string; slug: string };

// Phrases that are too generic to auto-link without noise.
const STOPLIST = new Set(["buy", "make", "new", "job", "part", "cost"]);

type Phrase = { phrase: string; slug: string; re: RegExp };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build the match list once: for each glossary entry, candidate phrases are the
// de-parenthesized term, its aliases, and the slug-as-words. Longest first so a
// specific phrase wins over a shorter substring.
const PHRASES: Phrase[] = (() => {
  const seen = new Set<string>();
  const out: Phrase[] = [];
  for (const { id, entry } of listEntries()) {
    const primary = getTermText(entry)
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .trim();
    const candidates = [
      primary,
      ...(entry.aliases ?? []),
      id.replace(/-/g, " ")
    ];
    for (const raw of candidates) {
      const phrase = raw.trim().toLowerCase();
      if (phrase.length < 3) continue;
      if (STOPLIST.has(phrase)) continue;
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      out.push({
        phrase,
        slug: id,
        re: new RegExp(`(?<![\\w-])(${escapeRegExp(phrase)})(?![\\w-])`, "i")
      });
    }
  }
  return out.sort((a, b) => b.phrase.length - a.phrase.length);
})();

/**
 * Split `text` into segments, wrapping the first whole-word occurrence of each
 * known glossary term once (case-insensitive). Only plain-string segments are
 * scanned, so terms never overlap and each slug links at most once.
 */
export function linkifyGlossary(text: string): GlossarySegment[] {
  let segments: GlossarySegment[] = [text];
  const usedSlugs = new Set<string>();

  for (const { slug, re } of PHRASES) {
    if (usedSlugs.has(slug)) continue;
    const next: GlossarySegment[] = [];
    let matched = false;
    for (const seg of segments) {
      if (matched || typeof seg !== "string") {
        next.push(seg);
        continue;
      }
      const m = seg.match(re);
      if (!m || m.index === undefined) {
        next.push(seg);
        continue;
      }
      const start = m.index;
      const end = start + m[1].length;
      if (start > 0) next.push(seg.slice(0, start));
      next.push({ text: seg.slice(start, end), slug });
      if (end < seg.length) next.push(seg.slice(end));
      matched = true;
    }
    if (matched) usedSlugs.add(slug);
    segments = next;
  }

  return segments;
}
