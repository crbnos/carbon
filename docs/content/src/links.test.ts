import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { splitByCodeFence, splitFrontmatter } from "./corpus";
import { terms } from "./glossary";
import { DOCS_URL } from "./links";

const sources = import.meta.glob(["../docs/**/*.mdx", "../guides/**/*.mdx"], {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;
const mdxFiles = Object.entries(sources).map(([file, raw]) => ({
  file: file.replace(/^\.\.\//, ""),
  raw
}));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

// Mirrors github-slugger, which fumadocs uses for heading ids.
const slugify = (heading: string) =>
  heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");

/** Route (`/docs/reference/jobs`) → heading anchors on that page. */
const pages = new Map<string, Set<string>>();
for (const { file, raw } of mdxFiles) {
  const route = `/${file}`.replace(/\.mdx$/, "").replace(/\/index$/, "");
  const { body } = splitFrontmatter(raw);
  const anchors = new Set(
    splitByCodeFence(body)
      .filter((seg) => !seg.code)
      .flatMap((seg) => seg.text.split("\n"))
      .filter((l) => /^#{1,6}\s/.test(l))
      .map((l) => slugify(l.replace(/^#{1,6}\s+/, "")))
  );
  pages.set(route, anchors);
}
// App routes the docs site renders without an MDX page of their own.
pages.set("/guides", new Set());

function brokenReason(link: string): string | null {
  const [route = "", anchor] = link.split("#");
  const anchors = pages.get(route.replace(/\/$/, ""));
  if (!anchors) return "no such page";
  if (anchor && !anchors.has(anchor)) return `no heading #${anchor}`;
  return null;
}

function walkSource(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSource(p, out);
    // Test files may hold deliberately stale URLs; only shipped links count.
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      out.push(p);
  }
  return out;
}

describe("doc links resolve to a real page and heading", () => {
  it("found the docs content", () => {
    expect(pages.size).toBeGreaterThan(50);
  });

  it("glossary hrefs", () => {
    const broken = Object.entries(terms).flatMap(([id, entry]) => {
      const href = (entry as { href?: string }).href;
      const reason = href && brokenReason(href);
      return reason ? [`${id}: ${href} (${reason})`] : [];
    });
    expect(broken).toEqual([]);
  });

  it(`hardcoded ${DOCS_URL} links in apps/ and packages/`, () => {
    const roots = ["apps", "packages"].flatMap((top) =>
      fs
        .readdirSync(path.join(REPO_ROOT, top))
        .flatMap((name) => [
          path.join(REPO_ROOT, top, name, "app"),
          path.join(REPO_ROOT, top, name, "src")
        ])
    );
    const pattern =
      /https:\/\/docs\.carbon\.ms(\/(?:docs|guides)[^\s"'`)\]]*)/g;
    const links = roots
      .flatMap((dir) => walkSource(dir))
      .flatMap((file) =>
        [...fs.readFileSync(file, "utf8").matchAll(pattern)].map((m) => ({
          file: path.relative(REPO_ROOT, file),
          link: m[1]!
        }))
      );
    expect(links.length).toBeGreaterThan(10);
    const broken = links.flatMap(({ file, link }) => {
      const reason = brokenReason(link);
      return reason ? [`${file}: ${link} (${reason})`] : [];
    });
    expect(broken).toEqual([]);
  });

  it("internal links inside the MDX", () => {
    const pattern = /\]\((\/(?:docs|guides)[^)\s]*)\)/g;
    const broken = mdxFiles.flatMap(({ file, raw }) =>
      splitByCodeFence(raw)
        .filter((seg) => !seg.code)
        .flatMap((seg) => [...seg.text.matchAll(pattern)])
        .flatMap((m) => {
          const reason = brokenReason(m[1]!);
          return reason ? [`${file}: ${m[1]} (${reason})`] : [];
        })
    );
    expect(broken).toEqual([]);
  });
});
