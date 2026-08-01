/**
 * generate-agent-kb — build the in-app agent's read-only knowledge base from the docs site.
 *
 * The Fumadocs MDX under `docs/content/**` is the source of truth. The in-app agent
 * (apps/erp `modules/agent`) reads a flattened, component-stripped copy of every page from
 * `apps/erp/app/modules/agent/kb/<slug>.md`, plus a `manifest.json` keyword index that
 * `search_docs` scans. This script regenerates both and prunes stale files.
 *
 * Committed output ships inside the erp Docker image, so the agent reads it with a bundled
 * import / fs read at runtime (no docs-app dependency). Mirrors the `generate-mcp.ts` pattern.
 *
 * Run it manually after editing docs/content, and commit the regenerated kb/ alongside
 * the docs change — same model as filling .po files before a commit. The check-and-commit
 * skill runs it automatically when docs/content or this script is in the change set.
 * See .ai/rules/agent-knowledge-base.md.
 *
 * Run:  pnpm run generate:agent-kb
 */
import fs from "node:fs";
import path from "node:path";

// Run from repo root via `pnpm run generate:agent-kb`.
const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "docs/content");
const KB_DIR = path.join(ROOT, "apps/erp/app/modules/agent/kb");
const MANIFEST_PATH = path.join(KB_DIR, "manifest.json");

type ManifestEntry = {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  headings: string[];
};

/** Recursively collect every .mdx file under a directory. */
function walkMdx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMdx(p));
    else if (entry.name.endsWith(".mdx")) out.push(p);
  }
  return out;
}

/** Split `---\n...\n---\n body` into raw frontmatter block + body. */
function splitFrontmatter(raw: string): { fm: string; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: "", body: raw };
  return { fm: m[1], body: m[2] };
}

/** Read a single-line `key: value` (value may be quoted) from a frontmatter block. */
function fmValue(fm: string, key: string): string {
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
function splitByCodeFence(md: string): { code: boolean; text: string }[] {
  const segments: { code: boolean; text: string }[] = [];
  let buf: string[] = [];
  let inCode = false;
  let fence = "";
  const flush = (code: boolean) => {
    if (buf.length) segments.push({ code, text: buf.join("\n") });
    buf = [];
  };
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (!inCode && m) {
      flush(false);
      inCode = true;
      fence = m[1];
      buf.push(line);
    } else if (inCode && m && m[1][0] === fence[0] && m[1].length >= fence.length) {
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
function stripComponents(body: string): string {
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
  // content is meant FOR this KB. Unwrap it — keep the content, drop the tags.
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

/** Collect `##`/`###` heading texts for the search manifest (ignoring code blocks). */
function headings(body: string): string[] {
  return splitByCodeFence(body)
    .filter((seg) => !seg.code)
    .flatMap((seg) => seg.text.split("\n"))
    .filter((l) => /^#{2,3}\s/.test(l))
    .map((l) => l.replace(/^#{2,3}\s+/, "").trim());
}

/** Derive keywords from the title + slug segments (docs frontmatter has none). */
function keywords(title: string, slug: string): string[] {
  const words = `${title} ${slug.replace(/[/-]/g, " ")}`
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return Array.from(new Set(words));
}

function main() {
  const files = walkMdx(CONTENT_DIR).sort();
  const written = new Set<string>();
  const manifest: ManifestEntry[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const slug = path
      .relative(CONTENT_DIR, file)
      .replace(/\.mdx$/, "")
      .split(path.sep)
      .join("/");

    const { fm, body } = splitFrontmatter(raw);
    const title = fmValue(fm, "title") || slug;
    const description = fmValue(fm, "description");
    const clean = stripComponents(body);

    const md = `# ${title}\n\n${description ? `> ${description}\n\n` : ""}${clean}\n`;
    const outPath = path.join(KB_DIR, `${slug}.md`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, md, "utf8");
    written.add(path.resolve(outPath));

    manifest.push({
      slug,
      title,
      description,
      keywords: keywords(title, slug),
      headings: headings(body),
    });
  }

  manifest.sort((a, b) => a.slug.localeCompare(b.slug));
  fs.mkdirSync(KB_DIR, { recursive: true });
  fs.writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(
      {
        _comment:
          "GENERATED by scripts/generate-agent-kb.ts from docs/content. Do not hand-edit — run `pnpm run generate:agent-kb`.",
        docs: manifest,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  // Drop a README so nobody hand-edits this folder. Added to `written` so the
  // prune step below doesn't delete it.
  const readmePath = path.join(KB_DIR, "README.md");
  fs.writeFileSync(
    readmePath,
    `# Agent knowledge base (auto-generated — do not edit)

Every file in this folder is generated from the docs site (\`docs/content/**\`) by
\`scripts/generate-agent-kb.ts\`. It is the read-only corpus the in-app agent searches
(\`search_docs\`) and reads (\`read_doc\`), bundled into the erp image so it ships with the app.

**Do not edit these files by hand — your changes will be overwritten.**

To update the content, edit the source docs under \`docs/content/\` and regenerate, then
commit the result **in the same commit** as the docs change (same model as filling \`.po\`
translations before committing):

\`\`\`bash
pnpm run generate:agent-kb
\`\`\`

The check-and-commit skill runs this automatically when \`docs/content/**\` or the generator
is in the change set. See \`.ai/rules/agent-knowledge-base.md\`.
`,
    "utf8"
  );
  written.add(path.resolve(readmePath));

  // Prune stale generated .md (source docs removed).
  const pruned: string[] = [];
  const walkKb = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkKb(p);
        if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
      } else if (entry.name.endsWith(".md") && !written.has(path.resolve(p))) {
        fs.rmSync(p);
        pruned.push(path.relative(KB_DIR, p));
      }
    }
  };
  walkKb(KB_DIR);

  console.log(`Wrote ${manifest.length} docs -> ${path.relative(ROOT, KB_DIR)}`);
  console.log(`Manifest: ${path.relative(ROOT, MANIFEST_PATH)}`);
  if (pruned.length) console.log(`Pruned ${pruned.length} stale: ${pruned.join(", ")}`);
}

main();
