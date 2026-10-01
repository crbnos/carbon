// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Shared "docs as plain markdown" toolkit — the single definition of how a Carbon
 * MDX page becomes component-free markdown a machine can read.
 *
 * Two consumers, one stripper (keep it that way):
 *  - `./agent-kb` — the in-app agent's corpus.
 *  - `docs/app/llms.txt` + `docs/app/llms-full.txt` (raw text read by `docs/lib/corpus.ts`) — the public
 *    index/corpus for AI crawlers and assistants (llmstxt.org convention).
 *
 * Pure — no fs — so it is safe in any bundle.
 */

/** Split `---\n...\n---\n body` into raw frontmatter block + body. */
export function splitFrontmatter(raw: string): { fm: string; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: "", body: raw };
  return { fm: m[1] ?? "", body: m[2] ?? "" };
}

/** Read a single-line `key: value` (value may be quoted) from a frontmatter block. */
export function fmValue(fm: string, key: string): string {
  const line = fm.split("\n").find((l) => l.trimStart().startsWith(`${key}:`));
  if (!line) return "";
  let v = line.slice(line.indexOf(":") + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  return v;
}

/**
 * Split markdown into alternating prose / fenced-code segments so transforms can
 * skip code. A fence is a line starting with ``` or ~~~ (optionally indented) and
 * runs until a line whose marker is the same char and at least as long (CommonMark).
 * Component-stripping and heading extraction both run through this, so "what is code"
 * has a single definition — code samples containing `<Generic>` or `## comment` lines
 * are never mangled or mistaken for headings.
 */
export function splitByCodeFence(
  md: string
): { code: boolean; text: string }[] {
  const segments: { code: boolean; text: string }[] = [];
  let buf: string[] = [];
  let inCode = false;
  let fence = "";
  const flush = (code: boolean) => {
    if (buf.length) segments.push({ code, text: buf.join("\n") });
    buf = [];
  };
  for (const line of md.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (!inCode && marker) {
      flush(false);
      inCode = true;
      fence = marker;
      buf.push(line);
    } else if (
      inCode &&
      marker &&
      marker.charAt(0) === fence.charAt(0) &&
      marker.length >= fence.length
    ) {
      buf.push(line);
      flush(true);
      inCode = false;
      fence = "";
    } else {
      buf.push(line);
    }
  }
  flush(inCode); // an unterminated fence keeps its remainder verbatim
  return segments;
}

/** Strip MDX components down to plain markdown/text the LLM can read. */
export function stripComponents(body: string): string {
  // Only transform prose; leave fenced code blocks byte-for-byte intact.
  const out = splitByCodeFence(body)
    .map((seg) => (seg.code ? seg.text : stripComponentsFromProse(seg.text)))
    .join("\n");
  // Collapse blank-line runs left behind.
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** The component-stripping regexes, applied to a prose (non-code) segment. */
function stripComponentsFromProse(body: string): string {
  let out = body;

  // <Term id="x">text</Term> -> text
  out = out.replace(/<Term\b[^>]*>([\s\S]*?)<\/Term>/g, "$1");

  // <Field name="X" type="Y">desc</Field> -> - **X** (Y): desc
  out = out.replace(
    /<Field\b[^>]*\bname="([^"]*)"[^>]*?(?:\btype="([^"]*)")?[^>]*>([\s\S]*?)<\/Field>/g,
    (_all, name, type, desc) =>
      `- **${name}**${type ? ` (${type})` : ""}: ${desc.trim()}`
  );

  // <Status name="X" ...>desc</Status> -> - **X**: desc
  out = out.replace(
    /<Status\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/Status>/g,
    (_all, name, desc) => `- **${name}**: ${desc.trim()}`
  );

  // <Card ... title="T" ...>...</Card> (or self-closing) -> - T
  out = out.replace(
    /<Card\b[^>]*\btitle="([^"]*)"[^>]*\/>/g,
    (_all, title) => `- ${title}`
  );
  out = out.replace(
    /<Card\b[^>]*\btitle="([^"]*)"[^>]*>([\s\S]*?)<\/Card>/g,
    (_all, title, inner) => `- ${title} ${String(inner).trim()}`.trim()
  );

  // Drop visual-only components entirely (images have no value without pixels).
  out = out.replace(/<Screenshot\b[^>]*\/>/g, "");
  out = out.replace(/<Screenshot\b[^>]*>[\s\S]*?<\/Screenshot>/g, "");
  out = out.replace(/<Figure\b[^>]*\/>/g, "");
  out = out.replace(/<Figure\b[^>]*>[\s\S]*?<\/Figure>/g, "");

  // <AgentContext> is agent-only: invisible on the site (renders null), but its inner
  // content is meant FOR the machine-readable corpora. Unwrap it — keep the content,
  // drop the tags.
  out = out.replace(/<\/?AgentContext\b[^>]*>/g, "");

  // Unwrap container components — keep the inner content, drop the tags.
  out = out.replace(/<\/?(?:FieldTable|StatusFlow|Steps|Cards)\b[^>]*>/g, "");
  out = out.replace(/<\/?Step\b[^>]*>/g, "");
  out = out.replace(/<Callout\b[^>]*>/g, "").replace(/<\/Callout>/g, "");

  // Any leftover self-closing / paired unknown components -> drop the tags, keep text.
  out = out.replace(/<[A-Z][A-Za-z0-9]*\b[^>]*\/>/g, "");
  out = out.replace(/<\/?[A-Z][A-Za-z0-9]*\b[^>]*>/g, "");

  // Rewrite in-doc links [text](/docs/slug#anchor) / (/guides/slug) -> `slug`
  out = out.replace(
    /\[[^\]]*\]\(\/(docs|guides)\/([^)#\s]+)(?:#[^)]*)?\)/g,
    (_all, base, slug) => `\`${base}/${String(slug).replace(/\/$/, "")}\``
  );

  return out;
}

/** Collect `##`/`###` heading texts (ignoring code blocks). */
export function headings(body: string): string[] {
  return splitByCodeFence(body)
    .filter((seg) => !seg.code)
    .flatMap((seg) => seg.text.split("\n"))
    .filter((l) => /^#{2,3}\s/.test(l))
    .map((l) => l.replace(/^#{2,3}\s+/, "").trim());
}

/** Derive keywords from the title + slug segments (docs frontmatter has none). */
export function keywords(title: string, slug: string): string[] {
  const words = `${title} ${slug.replace(/[/-]/g, " ")}`
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return Array.from(new Set(words));
}

/**
 * A heading's URL anchor as github-slugger (and so Fumadocs) makes it:
 * "Database — Supabase" -> "database--supabase".
 */
export function headingAnchor(heading: string): string {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

export type CorpusSection = {
  /** `null` for the text before the first heading. */
  heading: string | null;
  anchor: string | null;
  markdown: string;
};

/**
 * Split stripped markdown at its `##` / `###` headings, ignoring code blocks. A repeated
 * heading gets github-slugger's `-1`, `-2` suffix, so every anchor links on the site.
 */
export function splitSections(markdown: string): CorpusSection[] {
  const sections: CorpusSection[] = [];
  const seen = new Map<string, number>();
  let heading: string | null = null;
  let anchor: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join("\n").trim();
    if (text) sections.push({ heading, anchor, markdown: text });
    lines = [];
  };
  for (const seg of splitByCodeFence(markdown)) {
    if (seg.code) {
      lines.push(seg.text);
      continue;
    }
    for (const line of seg.text.split("\n")) {
      const match = /^#{2,3}\s+(.+)$/.exec(line);
      if (!match?.[1]) {
        lines.push(line);
        continue;
      }
      flush();
      heading = match[1].trim();
      const base = headingAnchor(heading);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchor = count ? `${base}-${count}` : base;
      lines.push(line);
    }
  }
  flush();
  return sections;
}

export type CorpusPage = {
  /** Content-relative slug, e.g. `docs/reference/quotes` or `guides/order`. */
  slug: string;
  title: string;
  description: string;
  /** Component-stripped markdown body. */
  markdown: string;
  headings: string[];
};

/** Parse one page from its content-relative slug and raw MDX source. */
export function parsePage(slug: string, raw: string): CorpusPage {
  const { fm, body } = splitFrontmatter(raw);
  return {
    slug,
    title: fmValue(fm, "title") || slug,
    description: fmValue(fm, "description"),
    markdown: stripComponents(body),
    headings: headings(body)
  };
}
